// Teams 只读：经 Microsoft Graph v1.0 读聊天（Chat.Read，用户可自行同意）与团队频道
// （ChannelMessage.Read.All，需管理员同意，失败时给出清楚提示）。只做实时查询，不落本地库。
import { z } from 'zod';
import type { TeamsChatSummary, TeamsMessage } from '../../shared/mail';
import { getMicrosoftAccessToken } from './microsoft';
import { MicrosoftAuthError, type MicrosoftResource } from './oauth';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_TIMEOUT_MS = 20_000;

export type GraphFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const defaultGraphFetch: GraphFetch = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });

export interface GraphDeps {
  readonly fetchImpl?: GraphFetch;
  readonly token?: (resource: MicrosoftResource) => Promise<string>;
}

/** Graph 错误码 → 中文提示；403 区分「需管理员同意」与一般拒绝。 */
export function explainGraphError(status: number, body: unknown, resource: MicrosoftResource) {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (status === 401)
    return new MicrosoftAuthError('Teams 授权已失效，请在邮件设置中重新登录 Dundee Outlook', code);
  if (status === 403) {
    return new MicrosoftAuthError(
      resource === 'graph-channels'
        ? '读取团队频道消息被拒绝：ChannelMessage.Read.All 需要学校管理员同意，请改读聊天（list_teams_chats）'
        : `Teams 拒绝访问（${code || '403'}）：学校可能未允许该应用读取 Teams`,
      code || 'Forbidden',
    );
  }
  if (status === 404)
    return new MicrosoftAuthError('Teams 中找不到该聊天或频道', code || 'NotFound');
  if (status === 429)
    return new MicrosoftAuthError('Teams 请求过于频繁，请稍后再试', code || 'TooManyRequests');
  return new MicrosoftAuthError(
    `Teams 请求失败（${status}）：${message || code || '未知错误'}`,
    code || null,
  );
}

async function graphGet(path: string, resource: MicrosoftResource, deps: GraphDeps) {
  const token = await (deps.token ?? getMicrosoftAccessToken)(resource);
  const url = path.startsWith('https://') ? path : `${GRAPH_BASE}${path}`;
  let response;
  try {
    response = await (deps.fetchImpl ?? defaultGraphFetch)(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  } catch (cause) {
    throw new MicrosoftAuthError('无法连接 Microsoft Graph，请检查网络', null, { cause });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.status < 200 || response.status >= 300) {
    throw explainGraphError(response.status, body, resource);
  }
  return body;
}

/** @odata.nextLink 只接受 Graph 自身地址，避免把令牌带去别处。 */
export function safeNextLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.startsWith(`${GRAPH_BASE}/`) ? value : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

/** Teams 消息正文多为 HTML：去标签、解实体、合并空白，供模型与列表阅读。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<attachment[^>]*><\/attachment>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
      const lower = name.toLowerCase();
      if (lower in ENTITIES) return ENTITIES[lower]!;
      if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)));
      return entity;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const identitySchema = z
  .object({ displayName: z.string().nullable().optional() })
  .passthrough()
  .nullable()
  .optional();

const chatSchema = z
  .object({
    id: z.string(),
    topic: z.string().nullable().optional(),
    chatType: z.string().optional(),
    lastUpdatedDateTime: z.string().nullable().optional(),
    webUrl: z.string().nullable().optional(),
    members: z
      .array(z.object({ displayName: z.string().nullable().optional() }).passthrough())
      .optional(),
    lastMessagePreview: z
      .object({
        createdDateTime: z.string().nullable().optional(),
        from: z
          .object({ user: identitySchema, application: identitySchema })
          .passthrough()
          .nullable()
          .optional(),
        body: z
          .object({ contentType: z.string().optional(), content: z.string().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    id: z.string(),
    createdDateTime: z.string().nullable().optional(),
    messageType: z.string().optional(),
    deletedDateTime: z.string().nullable().optional(),
    webUrl: z.string().nullable().optional(),
    from: z
      .object({ user: identitySchema, application: identitySchema })
      .passthrough()
      .nullable()
      .optional(),
    body: z
      .object({ contentType: z.string().optional(), content: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    attachments: z
      .array(z.object({ name: z.string().nullable().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

function collection(body: unknown): { value: unknown[]; nextLink: string | null } {
  const object = (body ?? {}) as { value?: unknown; '@odata.nextLink'?: unknown };
  return {
    value: Array.isArray(object.value) ? object.value : [],
    nextLink: safeNextLink(object['@odata.nextLink']),
  };
}

export function parseChats(body: unknown): TeamsChatSummary[] {
  return collection(body)
    .value.map((item) => chatSchema.safeParse(item))
    .filter((result) => result.success)
    .map(({ data }) => ({
      id: data.id,
      topic: data.topic ?? null,
      chatType: data.chatType ?? 'unknown',
      members: (data.members ?? [])
        .map((member) => member.displayName ?? '')
        .filter((name) => name.length > 0),
      lastUpdatedAt: data.lastUpdatedDateTime ?? null,
      lastMessage: data.lastMessagePreview
        ? {
            from:
              data.lastMessagePreview.from?.user?.displayName ??
              data.lastMessagePreview.from?.application?.displayName ??
              null,
            text: bodyText(data.lastMessagePreview.body),
            createdAt: data.lastMessagePreview.createdDateTime ?? null,
          }
        : null,
      webUrl: data.webUrl ?? null,
    }))
    .sort((a, b) => recency(b).localeCompare(recency(a)));
}

function recency(chat: TeamsChatSummary): string {
  return chat.lastMessage?.createdAt ?? chat.lastUpdatedAt ?? '';
}

function bodyText(
  body: { contentType?: string; content?: string | null } | null | undefined,
): string {
  const content = body?.content ?? '';
  return body?.contentType === 'html' ? htmlToText(content) : content.trim();
}

/** /chats/{id}/members 的显示名列表。 */
export function parseMemberNames(body: unknown): string[] {
  return collection(body)
    .value.map((item) =>
      z.object({ displayName: z.string().nullable().optional() }).passthrough().safeParse(item),
    )
    .filter((result) => result.success)
    .map(({ data }) => data.displayName ?? '')
    .filter((name) => name.length > 0);
}

export function parseMessages(body: unknown): { items: TeamsMessage[]; nextLink: string | null } {
  const { value, nextLink } = collection(body);
  const items = value
    .map((item) => messageSchema.safeParse(item))
    .filter((result) => result.success)
    .map(({ data }) => data)
    .filter((data) => !data.deletedDateTime)
    .map((data) => {
      const content = data.body?.content ?? '';
      return {
        id: data.id,
        createdAt: data.createdDateTime ?? null,
        from: data.from?.user?.displayName ?? data.from?.application?.displayName ?? null,
        text: data.body?.contentType === 'html' ? htmlToText(content) : content.trim(),
        messageType: data.messageType ?? 'message',
        attachments: (data.attachments ?? [])
          .map((attachment) => attachment.name ?? '')
          .filter((name) => name.length > 0),
        webUrl: data.webUrl ?? null,
      };
    });
  return { items, nextLink };
}

const idSchema = z.string().trim().min(1).max(400);
const topSchema = z.number().int().min(1).max(50).default(20);

export async function listTeamsChats(limit: unknown = 20, deps: GraphDeps = {}) {
  const top = topSchema.parse(limit ?? 20);
  // 按最后一条消息时间倒序（Graph 文档给出的写法）；lastUpdatedDateTime 只反映改名/成员变动。
  const body = await graphGet(
    `/me/chats?$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime%20desc&$top=${top}`,
    'graph',
    deps,
  );
  const chats = parseChats(body).slice(0, top);
  // 无主题的聊天（多为 1:1）补成员名，否则无从辨认对方；单个失败不影响列表。
  return Promise.all(
    chats.map(async (chat) => {
      if (chat.topic) return chat;
      try {
        const members = parseMemberNames(
          await graphGet(`/chats/${encodeURIComponent(chat.id)}/members`, 'graph', deps),
        );
        return { ...chat, members };
      } catch {
        return chat;
      }
    }),
  );
}

/** 单个聊天的类型（oneOnOne / group / meeting）；查不到时为 unknown。 */
export async function getTeamsChatType(chatId: string, deps: GraphDeps = {}): Promise<string> {
  const body = await graphGet(`/chats/${encodeURIComponent(chatId)}`, 'graph', deps);
  return chatSchema.safeParse(body).data?.chatType ?? 'unknown';
}

export async function listTeamsChatMessages(
  chatId: unknown,
  limit: unknown = 20,
  deps: GraphDeps = {},
  cursor?: string | null,
) {
  const id = idSchema.parse(chatId);
  const top = topSchema.parse(limit ?? 20);
  const path = cursor
    ? (safeNextLink(cursor) ?? invalidCursor())
    : `/chats/${encodeURIComponent(id)}/messages?$top=${top}`;
  return parseMessages(await graphGet(path, 'graph', deps));
}

function invalidCursor(): never {
  throw new MicrosoftAuthError('分页游标无效，请从第一页重新读取');
}

export async function listJoinedTeams(deps: GraphDeps = {}) {
  const body = await graphGet('/me/joinedTeams', 'graph-channels', deps);
  const teams = collection(body)
    .value.map((item) =>
      z
        .object({ id: z.string(), displayName: z.string().nullable().optional() })
        .passthrough()
        .safeParse(item),
    )
    .filter((result) => result.success)
    .map(({ data }) => ({ id: data.id, name: data.displayName ?? null }));
  return Promise.all(
    teams.map(async (team) => {
      const channels = collection(
        await graphGet(`/teams/${encodeURIComponent(team.id)}/channels`, 'graph-channels', deps),
      )
        .value.map((item) =>
          z
            .object({ id: z.string(), displayName: z.string().nullable().optional() })
            .passthrough()
            .safeParse(item),
        )
        .filter((result) => result.success)
        .map(({ data }) => ({ id: data.id, name: data.displayName ?? null }));
      return { ...team, channels };
    }),
  );
}

export async function listTeamsChannelMessages(
  teamId: unknown,
  channelId: unknown,
  limit: unknown = 20,
  deps: GraphDeps = {},
  cursor?: string | null,
) {
  const team = idSchema.parse(teamId);
  const channel = idSchema.parse(channelId);
  const top = topSchema.parse(limit ?? 20);
  const path = cursor
    ? (safeNextLink(cursor) ?? invalidCursor())
    : `/teams/${encodeURIComponent(team)}/channels/${encodeURIComponent(channel)}/messages?$top=${top}`;
  return parseMessages(await graphGet(path, 'graph-channels', deps));
}
