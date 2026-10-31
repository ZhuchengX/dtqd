// 让已配置的模型读「最近更新.md」，只挑出对这名学生真正有用、重要的事（截止日期、等他回复、必须知道的通知）：
// 每条写成带通知的个人待办，在 DTQD 待办页与通知中心可见，同时写进「待办提取.md」。没配模型时跳过，不影响同步本身。
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { resolveModel } from '../agent/pi';
import { usableLlmProviders } from '../agent/providers';
import { addNoticedTodo } from '../todo';
import { formatTime } from './digest';

const MAX_PROMPT_CHARS = 60000;
const MAX_REMEMBERED_KEYS = 1000;

const itemSchema = z.object({
  kind: z.enum(['deadline', 'notice', 'reply']),
  title: z.string().trim().min(1).max(200),
  dueAt: z.string().nullable().optional(),
  importance: z.enum(['high', 'medium', 'low']).default('medium'),
  why: z.string().max(300).default(''),
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
    '从下面的消息里只挑出对这名学生本人真正有用、重要的事。宁缺毋滥：拿不准的不要，没有就返回空列表。分三类：',
    '- deadline：有明确日期的截止或安排（作业提交、考试、报名、选课、问卷、补考等）。dueAt 填 ISO 8601 时间并带时区，例如 2026-11-05T23:59:00+08:00；原文写的是英国时间就按英国时间换算。只给日期没给钟点时用当天 23:59。',
    '- notice：不看会吃亏的通知（课程/考试安排变动、成绩发布、补考与申诉规则、会影响学分或毕业的变化）。泛泛的手册、讲座、招聘、活动宣传不算，除非原文要求学生必须做什么。',
    '- reply：私聊或群聊里有人直接问这名学生、在等他回复的消息。',
    '每条给 importance：high＝影响成绩、学分、考试资格或有人急等回复；medium＝有用、有截止但影响较小；low＝知道也行不知道也无妨（low 直接不要输出）。',
    '闲聊、群发广告、招聘与活动宣传、已过期的事一律不要。title 用中文、20 字以内，写成要做的动作（如「提交 DI12006 作业 3」），保留课程代码。why 用一句中文说为什么对他重要、不做会怎样。conversation 填来源会话名，detail 用一两句中文写清具体怎么做、原文关键要求与链接。',
    '只输出一个 JSON 对象，不要别的文字：{"items":[{"kind":"deadline","importance":"high","title":"…","dueAt":"…","why":"…","conversation":"…","detail":"…"}]}。没有就输出 {"items":[]}。',
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

/** 只留重要的：high 都要；medium 只要有截止或等回复的；low 不要。已经过了截止时间的不要。 */
export function isImportant(item: TeamsTriageItem, now: number): boolean {
  if (item.importance === 'low') return false;
  if (item.importance === 'medium' && item.kind === 'notice') return false;
  return !item.dueAt || Date.parse(item.dueAt) > now;
}

/** 待办标题：截止日期直接写动作，其余加类型前缀，在待办列表里一眼分得出。 */
export function todoTitle(item: TeamsTriageItem): string {
  const prefix = item.kind === 'reply' ? '回复：' : item.kind === 'notice' ? '知悉：' : '';
  return `${prefix}${item.title}`.slice(0, 200);
}

/** 待办备注：首行（也是通知正文）写来源与为什么重要，其后是做法。 */
export function todoNotes(item: TeamsTriageItem): string {
  const head = [`Teams${item.conversation ? ` · ${item.conversation}` : ''}`, item.why]
    .filter(Boolean)
    .join(' · ');
  return [head, item.detail].filter(Boolean).join('\n');
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
      const mark = item.importance === 'high' ? '🔴 ' : '';
      lines.push(
        `- ${mark}**${due}${item.title}**${item.conversation ? `（${item.conversation}）` : ''}`,
      );
      if (item.why) lines.push(`  为什么重要：${item.why}`);
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

/** 提取是简单的整理活：有快速档（名字带 flash）就用它，省钱也快；否则用提供商的第一个模型。 */
export function triageModel(models: readonly string[]): string | undefined {
  return models.find((id) => /flash/i.test(id)) ?? models[0];
}

/** 用第一个可用提供商发一次无工具请求。 */
async function complete(prompt: string): Promise<string | null> {
  const provider = usableLlmProviders()[0];
  const modelId = provider && triageModel(provider.models);
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
  const important = items.filter((item) => isImportant(item, now));
  await writeFile(join(dir, '待办提取.md'), triageMarkdown(important, now));
  const keys = await readKeys(dir);
  const known = new Set(keys);
  const added: string[] = [];
  for (const item of important) {
    const key = triageKey(item);
    if (known.has(key)) continue;
    // 有截止时间的同时上日历，月/周视图里看得到。
    addNoticedTodo({
      title: todoTitle(item),
      notes: todoNotes(item),
      dueAt: item.dueAt,
      calendar: Boolean(item.dueAt),
    });
    known.add(key);
    added.push(key);
  }
  if (added.length) await writeKeys(dir, [...keys, ...added]);
  return { status: 'ok', items: important, todos: added.length };
}
