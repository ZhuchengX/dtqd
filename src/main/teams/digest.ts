// 把增量读到的 Teams 消息整理成按会话分组的 Markdown，供学生翻看和 agent 汇总。
import {
  conversationKind,
  htmlToText,
  isUserMessage,
  type RawTeamsConversation,
  type RawTeamsMessage,
  type TeamsConversationKind,
  type TeamsMention,
} from './extract';

const MAX_MESSAGE_CHARS = 4000;
export const FIRST_DIGEST_DAYS = 14;

export interface TeamsThread {
  conversationId: string;
  kind: TeamsConversationKind;
  name: string;
  messages: Array<{ time: number; author: string; text: string; replyChainId: string }>;
}

/** 频道显示为「团队 › 频道」；没有主题的聊天用参与者名字。 */
export function conversationNames(
  conversations: readonly RawTeamsConversation[],
  messages: readonly RawTeamsMessage[],
): Map<string, string> {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const authors = new Map<string, Set<string>>();
  for (const m of messages) {
    if (!m.author) continue;
    const set = authors.get(m.conversationId) ?? new Set<string>();
    set.add(m.author);
    authors.set(m.conversationId, set);
  }
  const names = new Map<string, string>();
  for (const id of new Set([...byId.keys(), ...authors.keys()])) {
    const conversation = byId.get(id);
    const topic = conversation?.topic.trim() ?? '';
    if (conversation && conversationKind(conversation) === '频道') {
      const team = byId.get(conversation.teamId)?.topic.trim() || '未命名团队';
      const channel = conversation.id === conversation.teamId ? 'General' : topic || 'General';
      names.set(id, `${team} › ${channel}`);
      continue;
    }
    const people = [...(authors.get(id) ?? [])].slice(0, 3).join('、');
    names.set(id, topic || people || id.slice(0, 24));
  }
  return names;
}

export function buildThreads(
  conversations: readonly RawTeamsConversation[],
  messages: readonly RawTeamsMessage[],
  mentions: ReadonlyMap<string, TeamsMention> = new Map(),
): TeamsThread[] {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const names = conversationNames(conversations, messages);
  const threads = new Map<string, TeamsThread>();
  for (const message of messages) {
    if (!isUserMessage(message)) continue;
    const body = htmlToText(message.content).slice(0, MAX_MESSAGE_CHARS);
    if (!body) continue;
    // @我、回复我 的消息在正文前打标，重要事项提取据此优先处理。
    const mention = mentions.get(message.id);
    const text = mention ? `【${mention}】${body}` : body;
    const conversation = byId.get(message.conversationId);
    const thread = threads.get(message.conversationId) ?? {
      conversationId: message.conversationId,
      kind: conversation ? conversationKind(conversation) : ('其他' as const),
      name: names.get(message.conversationId) ?? message.conversationId,
      messages: [],
    };
    thread.messages.push({
      time: message.time,
      author: message.author || '未知',
      text,
      replyChainId: message.replyChainId,
    });
    threads.set(message.conversationId, thread);
  }
  return [...threads.values()]
    .map((thread) => ({
      ...thread,
      messages: [...thread.messages].sort((a, b) => a.time - b.time),
    }))
    .sort((a, b) => (b.messages.at(-1)?.time ?? 0) - (a.messages.at(-1)?.time ?? 0));
}

export function formatTime(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 一个会话的若干条消息，追加到该会话的存档文件末尾。 */
export function threadMarkdown(thread: TeamsThread): string {
  return thread.messages
    .map((m) => `### ${formatTime(m.time)} · ${m.author}\n\n${m.text}\n`)
    .join('\n');
}

/** 进入 AI 提取的会话：私聊要学生另外开启；分不清类型的按私聊处理。 */
export function extractionThreads(
  threads: readonly TeamsThread[],
  includePrivate: boolean,
): TeamsThread[] {
  return threads.filter(
    (thread) => includePrivate || (thread.kind !== '私聊' && thread.kind !== '其他'),
  );
}

/** 首次同步或长期关闭后再开，会读到大量旧消息；汇总只取最近几天。 */
export function digestStart(since: number, now: number): number {
  return Math.max(since, now - FIRST_DIGEST_DAYS * 86_400_000);
}

export function recentThreads(threads: readonly TeamsThread[], from: number): TeamsThread[] {
  return threads
    .map((thread) => ({ ...thread, messages: thread.messages.filter((m) => m.time > from) }))
    .filter((thread) => thread.messages.length > 0);
}

/** 交给 AI 提取的两份汇总：群聊和私聊分开，由提取时的最新开关决定发哪份；没有内容时为空串。 */
export function extractionDigests(
  threads: readonly TeamsThread[],
  since: number,
  now: number,
): { groupDigest: string; privateDigest: string } {
  const group = extractionThreads(threads, false);
  const privateThreads = threads.filter((thread) => !group.includes(thread));
  // 提取超长时留末尾，所以最近活跃的会话排在最后（「最近更新.md」给人看，仍是新的在前）。
  const digest = (part: readonly TeamsThread[]) =>
    recentThreads(part, digestStart(since, now)).length > 0
      ? digestMarkdown([...part].reverse(), since, now)
      : '';
  return { groupDigest: digest(group), privateDigest: digest(privateThreads) };
}

/** 本次同步的新消息汇总（覆盖写入「最近更新.md」）。 */
export function digestMarkdown(
  threads: readonly TeamsThread[],
  since: number,
  now: number,
): string {
  const from = digestStart(since, now);
  const recent = recentThreads(threads, from);
  const total = recent.reduce((sum, thread) => sum + thread.messages.length, 0);
  const firstNote =
    since > 0 ? '' : `（首次同步，只汇总最近 ${FIRST_DIGEST_DAYS} 天；更早的消息在各会话存档里）`;
  const header = [
    '# Teams 最近更新',
    '',
    `- 时间范围：${formatTime(from)} → ${formatTime(now)}${firstNote}`,
    `- 新消息：${total} 条，${recent.length} 个会话`,
    '',
  ];
  if (recent.length === 0) return [...header, '没有新消息。', ''].join('\n');
  const sections = recent.map(
    (thread) => `## [${thread.kind}] ${thread.name}\n\n${threadMarkdown(thread)}`,
  );
  return [...header, ...sections].join('\n');
}
