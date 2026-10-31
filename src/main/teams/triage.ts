// 让已配置的模型读「最近更新.md」，挑出截止日期、老师通知与需要回复的消息：
// 截止日期与待回复写成个人待办，三类都写进「待办提取.md」。没配模型时跳过，不影响同步本身。
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { resolveModel } from '../agent/pi';
import { usableLlmProviders } from '../agent/providers';
import { saveTodo } from '../todo';
import { formatTime } from './digest';

const MAX_PROMPT_CHARS = 60000;
const MAX_REMEMBERED_KEYS = 1000;

const itemSchema = z.object({
  kind: z.enum(['deadline', 'notice', 'reply']),
  title: z.string().trim().min(1).max(200),
  dueAt: z.string().nullable().optional(),
  conversation: z.string().max(300).default(''),
  detail: z.string().max(2000).default(''),
});
export type TeamsTriageItem = Omit<z.infer<typeof itemSchema>, 'dueAt'> & { dueAt: string | null };

export interface TeamsTriageResult {
  status: 'ok' | 'no-model' | 'failed';
  items: TeamsTriageItem[];
  todos: number;
}

export function triagePrompt(digest: string, now: number): string {
  const body =
    digest.length > MAX_PROMPT_CHARS
      ? `${digest.slice(0, MAX_PROMPT_CHARS)}\n\n（后面还有内容，已截断）`
      : digest;
  return [
    `你在帮一名中南大学邓迪国际学院（DIICSU）的学生整理 Microsoft Teams 消息。现在是 ${formatTime(now)}（北京时间 UTC+8）。`,
    '从下面的消息里挑出跟这名学生有关、需要他知道或去做的事，分三类：',
    '- deadline：有明确日期的截止或安排（作业提交、考试、报名、选课、问卷、补考等）。dueAt 填 ISO 8601 时间并带时区，例如 2026-11-05T23:59:00+08:00；原文写的是英国时间就按英国时间换算。只给日期没给钟点时用当天 23:59。',
    '- notice：老师或学院的重要通知，没有截止日期但值得知道（课程变动、成绩发布、规则变化）。',
    '- reply：私聊或群聊里有人直接问这名学生、在等他回复的消息。',
    '只要可以行动或必须知道的；闲聊、活动广告、已过期的事不要。title 用中文、20 字以内，保留课程代码（如 DI12006）。conversation 填来源会话名，detail 用一两句中文写清要做什么、原文关键要求与链接。',
    '只输出一个 JSON 对象，不要别的文字：{"items":[{"kind":"deadline","title":"…","dueAt":"…","conversation":"…","detail":"…"}]}。没有就输出 {"items":[]}。',
    '',
    '---',
    '',
    body,
  ].join('\n');
}

/** 模型回复里取出 JSON；容忍代码块包裹与前后多余文字，坏条目丢掉不影响其余。 */
export function parseTriage(text: string): TeamsTriageItem[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((entry) => {
    const item = itemSchema.safeParse(entry);
    if (!item.success) return [];
    const due = item.data.dueAt ? new Date(item.data.dueAt) : null;
    const dueAt = due && !Number.isNaN(due.getTime()) ? due.toISOString() : null;
    return [{ ...item.data, dueAt }];
  });
}

/** 同一件事（类型 + 标题 + 截止时间）只建一次待办。 */
export function triageKey(item: TeamsTriageItem): string {
  return createHash('sha256')
    .update(`${item.kind}|${item.title}|${item.dueAt ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

/** 截止日期与待回复才进待办；已经过了截止时间的不建。 */
export function wantsTodo(item: TeamsTriageItem, now: number): boolean {
  if (item.kind === 'notice') return false;
  return !item.dueAt || Date.parse(item.dueAt) > now;
}

const KIND_TITLES: Record<TeamsTriageItem['kind'], string> = {
  deadline: '截止日期',
  reply: '等你回复',
  notice: '通知',
};

export function triageMarkdown(items: readonly TeamsTriageItem[], now: number): string {
  const lines = ['# Teams 待办提取', '', `- 生成时间：${formatTime(now)}`, ''];
  if (items.length === 0) return [...lines, '这次的新消息里没有需要处理的事。', ''].join('\n');
  for (const kind of ['deadline', 'reply', 'notice'] as const) {
    const group = items
      .filter((item) => item.kind === kind)
      .sort((a, b) => (a.dueAt ?? 'z').localeCompare(b.dueAt ?? 'z'));
    if (group.length === 0) continue;
    lines.push(`## ${KIND_TITLES[kind]}（${group.length}）`, '');
    for (const item of group) {
      const due = item.dueAt ? `${formatTime(Date.parse(item.dueAt))} · ` : '';
      lines.push(`- **${due}${item.title}**${item.conversation ? `（${item.conversation}）` : ''}`);
      if (item.detail) lines.push(`  ${item.detail}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function readKeys(dir: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, '.triage-state.json'), 'utf8')) as {
      keys?: unknown;
    };
    return Array.isArray(parsed.keys) ? parsed.keys.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

async function writeKeys(dir: string, keys: readonly string[]): Promise<void> {
  const path = join(dir, '.triage-state.json');
  await writeFile(`${path}.tmp`, JSON.stringify({ keys: keys.slice(-MAX_REMEMBERED_KEYS) }));
  await rename(`${path}.tmp`, path);
}

/** 用第一个可用提供商的第一个模型发一次无工具请求。 */
async function complete(prompt: string): Promise<string | null> {
  const provider = usableLlmProviders()[0];
  const modelId = provider?.models[0];
  if (!provider || !modelId) return null;
  const { model } = await resolveModel({ provider, model: modelId, effort: null });
  const { completeSimple } = await import('@earendil-works/pi-ai/compat');
  const reply = await completeSimple(
    model,
    { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
    { apiKey: provider.apiKey, maxTokens: 16000, signal: AbortSignal.timeout(300000) },
  );
  if (reply.stopReason === 'error') throw new Error(reply.errorMessage ?? '模型请求失败');
  const text = reply.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  // 推理模型偶尔把答案只放在思考内容里，正文为空时退回思考内容找 JSON。
  const fallback = text.trim()
    ? text
    : reply.content.map((block) => (block.type === 'thinking' ? block.thinking : '')).join('');
  // 只记长度与结束原因，不记正文（含学生消息）。
  console.info('[teams] 待办提取回复', modelId, reply.stopReason, text.length, fallback.length);
  return fallback;
}

/** 读 dir 下的「最近更新.md」，写「待办提取.md」并把新事项加进待办。 */
export async function triageTeamsDigest(dir: string): Promise<TeamsTriageResult> {
  const now = Date.now();
  const digest = await readFile(join(dir, '最近更新.md'), 'utf8');
  const text = await complete(triagePrompt(digest, now));
  if (text === null) return { status: 'no-model', items: [], todos: 0 };
  const items = parseTriage(text);
  if (!items) return { status: 'failed', items: [], todos: 0 };
  await writeFile(join(dir, '待办提取.md'), triageMarkdown(items, now));
  const keys = await readKeys(dir);
  const known = new Set(keys);
  const added: string[] = [];
  for (const item of items) {
    const key = triageKey(item);
    if (known.has(key) || !wantsTodo(item, now)) continue;
    saveTodo({
      title: item.title,
      notes: [`来自 Teams${item.conversation ? ` · ${item.conversation}` : ''}`, item.detail]
        .filter(Boolean)
        .join('\n'),
      dueAt: item.dueAt,
    });
    known.add(key);
    added.push(key);
  }
  if (added.length) await writeKeys(dir, [...keys, ...added]);
  return { status: 'ok', items, todos: added.length };
}
