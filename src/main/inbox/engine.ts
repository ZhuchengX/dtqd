// 重要事项提取：把各来源的新内容连同「我是谁」（在读课程、兴趣）交给已配置的模型，
// 只留对这名学生真正有用、重要的事：截止日期、等他回复、不看会吃亏的通知。
// 每条建成带通知的个人待办，并覆盖写「待办提取.md」。同一件事跨来源只建一次（课程代码 + 截止日期去重）。
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { inboxSourceLabels, type InboxSource } from '../../shared/inbox';
import { resolveModel } from '../agent/pi';
import { usableLlmProviders } from '../agent/providers';
import { addNoticedTodo } from '../todo';

const MAX_PROMPT_CHARS = 60000;
const MAX_REMEMBERED_KEYS = 2000;
const sources = Object.keys(inboxSourceLabels) as [InboxSource, ...InboxSource[]];

export interface InboxInput {
  source: InboxSource;
  /** 该来源本次的新内容（Markdown 或纯文本）。 */
  text: string;
}

export interface InboxProfile {
  /** 本学年在读课程，如「DI12006 Statistics」。 */
  courses: string[];
  interests: string[];
}

const itemSchema = z.object({
  kind: z.enum(['deadline', 'notice', 'reply']),
  title: z.string().trim().min(1).max(200),
  dueAt: z.string().nullable().optional(),
  importance: z.enum(['high', 'medium', 'low']).default('medium'),
  why: z.string().max(300).default(''),
  source: z.enum(sources).catch('teams'),
  course: z.string().trim().max(40).default(''),
  conversation: z.string().max(300).default(''),
  detail: z.string().max(2000).default(''),
});
export type InboxItem = Omit<z.infer<typeof itemSchema>, 'dueAt'> & { dueAt: string | null };

export interface ModelUsage {
  input: number;
  output: number;
  cost: number;
}

export interface InboxTriageResult {
  status: 'ok' | 'no-model' | 'failed';
  items: InboxItem[];
  todos: number;
  model: string | null;
  usage?: ModelUsage;
}

const SOURCE_HINTS: Record<InboxSource, string> = {
  teams:
    '班级频道与聊天消息；正文以【@我】或【回复我】开头的是直接冲着这名学生的，要提出来、importance 至少 medium，需要他回话的归 reply；私聊里直接问他的也归 reply。会话标题后的（课程：…）就是 course。',
  outlook: '邮件；群发通讯、营销、系统自动通知一般不要，老师或学院直接要求学生做的事要。',
  mydundee: '课程官方公告，截止时间以这里为准。',
  campus:
    '中南大学和邓迪国际学院官网的公开通知，多数面向全校。只有明确涉及本学院本科生或学生所选方向、且有截止时间或需要行动的才算。',
  qq: '只有 QQ 收到的文件名与时间，没有正文；只有文件名明确是考试安排、作业要求、截止通知时才提出，title 写「查看 QQ 收到的《文件名》」。',
};

function profileLines(profile: InboxProfile): string[] {
  const lines: string[] = [];
  if (profile.courses.length)
    lines.push(
      `这名学生本学年在读课程：${profile.courses.join('；')}。只关心这些课；往年的课、补考频道、与他无关的课程消息一律不要。`,
    );
  if (profile.interests.length)
    lines.push(
      `他关心的方向：${profile.interests.join('、')}。与这些方向相关、且有报名或申请截止的机会，按 deadline 提出（importance 至少 medium）；无关方向的招聘、讲座、活动不要。`,
    );
  return lines;
}

export function inboxPrompt(
  inputs: readonly InboxInput[],
  profile: InboxProfile,
  now: string,
): string {
  let budget = MAX_PROMPT_CHARS;
  const bodies = inputs.map((input) => {
    const text =
      input.text.length > budget ? `${input.text.slice(0, budget)}\n（后面已截断）` : input.text;
    budget = Math.max(0, budget - text.length);
    return `## 来源：${input.source}（${inboxSourceLabels[input.source]}；${SOURCE_HINTS[input.source]}）\n\n${text}`;
  });
  return [
    `你在帮一名中南大学邓迪国际学院（DIICSU）的学生整理他各渠道收到的新消息。现在是 ${now}（北京时间 UTC+8）。`,
    ...profileLines(profile),
    '从下面的内容里只挑出对这名学生本人真正有用、重要的事。宁缺毋滥：拿不准的不要，没有就返回空列表。分三类：',
    '- deadline：有明确日期的截止或安排（作业提交、考试、报名、选课、问卷、补考、申请等）。dueAt 填 ISO 8601 时间并带时区，例如 2026-11-05T23:59:00+08:00；原文写的是英国时间就按英国时间换算（英国 10 月最后一个周日至 3 月最后一个周日为 GMT，比北京晚 8 小时；其余为 BST，晚 7 小时）。只给日期没给钟点时用当天 23:59。',
    '- notice：不看会吃亏的通知（课程/考试安排变动、成绩发布、补考与申诉规则、会影响学分或毕业的变化）。泛泛的手册、讲座、活动宣传不算，除非原文要求学生必须做什么。',
    '- reply：有人直接问这名学生、在等他回复的消息。',
    '每条给 importance：high＝影响成绩、学分、考试资格或有人急等回复；medium＝有用、有截止但影响较小；low＝知道也行不知道也无妨（low 直接不要输出）。',
    '同一件事在多个来源出现时只输出一次，source 填最权威的来源（myDundee 公告 > Outlook > Teams > QQ）。',
    'title 用中文、20 字以内，写成要做的动作（如「提交 DI12006 作业 3」）。course 填课程代码（如 DI12006），没有就空串。why 用一句中文说为什么对他重要、不做会怎样。conversation 填来源会话、发件人或课程名，detail 用一两句中文写清具体怎么做、原文关键要求与链接。',
    '只输出一个 JSON 对象，不要别的文字：{"items":[{"kind":"deadline","importance":"high","source":"mydundee","course":"DI12006","title":"…","dueAt":"…","why":"…","conversation":"…","detail":"…"}]}。没有就输出 {"items":[]}。',
    '',
    '---',
    '',
    ...bodies,
  ].join('\n');
}

/** 模型回复里取出 JSON；容忍代码块包裹与前后多余文字，坏条目丢掉不影响其余。 */
export function parseInboxItems(text: string): InboxItem[] | null {
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
    return [{ ...item.data, course: item.data.course.toUpperCase(), dueAt }];
  });
}

/** 北京时间的日期（YYYY-MM-DD）：同一天截止的同一门课算同一件事。 */
function beijingDate(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 去重键：有课程代码和截止日期时按「类型 + 课程 + 日期」，跨来源、标题措辞不同也认得出；否则按标题。 */
export function inboxKey(item: InboxItem): string {
  const basis =
    item.dueAt && item.course
      ? `${item.kind}|${item.course}|${beijingDate(item.dueAt)}`
      : `${item.kind}|${item.course}|${item.title}|${item.dueAt ? beijingDate(item.dueAt) : ''}`;
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

/** 只留重要的：high 都要；medium 只要有截止或等回复的；low 不要。已经过了截止时间的不要。 */
export function isImportant(item: InboxItem, now: number): boolean {
  if (item.importance === 'low') return false;
  if (item.importance === 'medium' && item.kind === 'notice') return false;
  return !item.dueAt || Date.parse(item.dueAt) > now;
}

/** 本批内同一件事只留一条（保留最先出现、即模型认为最权威的那条）。 */
export function dedupeItems(items: readonly InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = inboxKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 待办标题：截止日期直接写动作，其余加类型前缀，在待办列表里一眼分得出。 */
export function todoTitle(item: InboxItem): string {
  const prefix = item.kind === 'reply' ? '回复：' : item.kind === 'notice' ? '知悉：' : '';
  return `${prefix}${item.title}`.slice(0, 200);
}

const AI_LABEL = 'AI 提取，以原始通知为准';

/** 待办备注：首行（也是通知正文）写来源与为什么重要，其后是做法。 */
export function todoNotes(item: InboxItem): string {
  const head = [
    `${inboxSourceLabels[item.source]}${item.conversation ? ` · ${item.conversation}` : ''}`,
    item.why,
  ]
    .filter(Boolean)
    .join(' · ');
  return [head, item.detail, AI_LABEL].filter(Boolean).join('\n');
}

export function formatTime(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const KIND_TITLES: Record<InboxItem['kind'], string> = {
  deadline: '截止日期',
  reply: '等你回复',
  notice: '通知',
};

export function inboxMarkdown(items: readonly InboxItem[], now: number): string {
  const lines = ['# 重要事项', '', `- 生成时间：${formatTime(now)}`, `- ${AI_LABEL}`, ''];
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
      const from = [inboxSourceLabels[item.source], item.conversation].filter(Boolean).join(' · ');
      lines.push(`- ${mark}**${due}${item.title}**（${from}）`);
      if (item.why) lines.push(`  为什么重要：${item.why}`);
      if (item.detail) lines.push(`  ${item.detail}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function readKeys(dir: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, '.inbox-keys.json'), 'utf8')) as {
      keys?: unknown;
    };
    return Array.isArray(parsed.keys) ? parsed.keys.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

async function writeKeys(dir: string, keys: readonly string[]): Promise<void> {
  const path = join(dir, '.inbox-keys.json');
  await writeFile(`${path}.tmp`, JSON.stringify({ keys: keys.slice(-MAX_REMEMBERED_KEYS) }));
  await rename(`${path}.tmp`, path);
}

/** 提取是简单的整理活：有快速档（名字带 flash）就用它，省钱也快；否则用提供商的第一个模型。 */
export function triageModel(models: readonly string[]): string | undefined {
  return models.find((id) => /flash/i.test(id)) ?? models[0];
}

/** 已配置模型时返回将使用的模型名。 */
export function configuredTriageModel(): string | null {
  const provider = usableLlmProviders()[0];
  return (provider && triageModel(provider.models)) ?? null;
}

/** 用第一个可用提供商发一次无工具请求。 */
async function complete(
  prompt: string,
): Promise<{ text: string; model: string; usage: ModelUsage } | null> {
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
  const answer = text.trim()
    ? text
    : reply.content.map((block) => (block.type === 'thinking' ? block.thinking : '')).join('');
  // 只记长度与结束原因，不记正文（含学生消息）。
  console.info('[inbox] 模型回复', modelId, reply.stopReason, answer.length);
  const usage = {
    input: reply.usage?.input ?? 0,
    output: reply.usage?.output ?? 0,
    cost: reply.usage?.cost?.total ?? 0,
  };
  return { text: answer, model: modelId, usage };
}

/** 提取各来源新内容里的重要事项：写 dir/待办提取.md，新事项建成带通知的待办。 */
export async function triageInbox(
  dir: string,
  inputs: readonly InboxInput[],
  profile: InboxProfile,
): Promise<InboxTriageResult> {
  const now = Date.now();
  const reply = await complete(inboxPrompt(inputs, profile, formatTime(now)));
  if (reply === null) return { status: 'no-model', items: [], todos: 0, model: null };
  const parsed = parseInboxItems(reply.text);
  if (!parsed)
    return { status: 'failed', items: [], todos: 0, model: reply.model, usage: reply.usage };
  const important = dedupeItems(parsed.filter((item) => isImportant(item, now)));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '待办提取.md'), inboxMarkdown(important, now));
  const keys = await readKeys(dir);
  const known = new Set(keys);
  const added: string[] = [];
  for (const item of important) {
    const key = inboxKey(item);
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
  return {
    status: 'ok',
    items: important,
    todos: added.length,
    model: reply.model,
    usage: reply.usage,
  };
}
