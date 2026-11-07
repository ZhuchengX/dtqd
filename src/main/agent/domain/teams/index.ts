// Teams 只读命令。存档命令（./archive）读本机同步下来的消息，学生默认用这组；
// Graph 命令是上游保留代码，要自备 Azure 应用并登录 Microsoft 365 才可用，实时联网查询，不落本地库。
import { z } from 'zod';
import {
  getTeamsChatType,
  listJoinedTeams,
  listTeamsChannelMessages,
  listTeamsChatMessages,
  listTeamsChats,
} from '../../../mail/graph';
import { inboxPrefs } from '../../../inbox/prefs';
import { getMicrosoftConfig } from '../../../mail/microsoft';
import { coverage, cursorPage, freshness, tool, toolError } from '../shared';
import { PRIVATE_HIDDEN, teamsArchiveTools } from './archive';

function assertSignedIn(): void {
  if (!getMicrosoftConfig().signedIn) {
    throw toolError(
      'NOT_CONFIGURED',
      '这条命令需要 Microsoft 365 登录，学生默认没有；请改用 list_teams_archive、read_teams_archive、search_teams_archive 读本机 Teams 存档',
    );
  }
}

/** Graph/令牌错误转成 dela 命令的错误码，保留中文说明。 */
function asToolError(error: unknown): never {
  if (error instanceof Error && error.name === 'MicrosoftAuthError') {
    const code = (error as Error & { code?: string | null }).code ?? '';
    if (/Forbidden|channels_not_requested|consent/i.test(code))
      throw toolError('NOT_CONFIGURED', error.message);
    if (/NotFound/.test(code)) throw toolError('NOT_FOUND', error.message);
    if (/TooManyRequests/.test(code)) throw toolError('RATE_LIMITED', error.message);
    if (/invalid_grant|InvalidAuthenticationToken/i.test(code) || /重新登录/.test(error.message))
      throw toolError('AUTH_EXPIRED', error.message);
    throw toolError('UPSTREAM_ERROR', error.message);
  }
  throw error;
}

const limit = z.number().int().min(1).max(50).default(20);

/** 和存档一样：只有群聊和会议聊天不受私聊开关限制，分不清类型的按私聊处理。 */
const GROUP_CHAT_TYPES = new Set(['group', 'meeting']);

export const listTeamsChatsTool = tool(
  '列出 Microsoft Teams 最近的聊天（1:1、群聊、会议聊天）：id、主题、成员、最近更新时间。只读，实时联网。read_teams_messages 的 chatId 取自这里。',
  z.object({ limit }).strict(),
  async ({ limit: top }) => {
    assertSignedIn();
    try {
      const chats = await listTeamsChats(top);
      const items = inboxPrefs().teamsPrivate
        ? chats
        : chats.filter((chat) => GROUP_CHAT_TYPES.has(chat.chatType));
      const hidden = items.length < chats.length ? [PRIVATE_HIDDEN] : [];
      return {
        items,
        freshness: freshness('realtime'),
        coverage: coverage('teams_recent_chats', false, [`只列出最近 ${top} 个聊天`, ...hidden]),
      };
    } catch (error) {
      asToolError(error);
    }
  },
);

export const readTeamsMessagesTool = tool(
  '读取 Teams 消息（最新在前）：传 chatId 读聊天；或传 teamId+channelId 读团队频道（需管理员已同意 ChannelMessage.Read.All）。只读，实时联网；正文已从 HTML 转为纯文本。翻页把 nextCursor 原样传回 cursor。',
  z
    .object({
      chatId: z.string().min(1).max(400).optional(),
      teamId: z.string().min(1).max(400).optional(),
      channelId: z.string().min(1).max(400).optional(),
      limit,
      cursor: z.string().max(4000).optional(),
    })
    .strict()
    .refine((input) => Boolean(input.chatId) !== Boolean(input.teamId && input.channelId), {
      message: '传 chatId，或同时传 teamId 与 channelId（二选一）',
    }),
  async (input) => {
    assertSignedIn();
    try {
      if (
        input.chatId &&
        !inboxPrefs().teamsPrivate &&
        !GROUP_CHAT_TYPES.has(await getTeamsChatType(input.chatId))
      )
        throw toolError('NOT_CONFIGURED', PRIVATE_HIDDEN);
      const { items, nextLink } = input.chatId
        ? await listTeamsChatMessages(input.chatId, input.limit, {}, input.cursor)
        : await listTeamsChannelMessages(
            input.teamId,
            input.channelId,
            input.limit,
            {},
            input.cursor,
          );
      return {
        ...cursorPage(items, nextLink),
        freshness: freshness('realtime'),
        coverage: coverage('teams_messages_page', nextLink === null),
      };
    } catch (error) {
      asToolError(error);
    }
  },
);

export const listTeamsChannelsTool = tool(
  '列出已加入的 Teams 团队及其频道（teamId/channelId）。可选能力：登录时需勾选「团队频道消息」，且学校管理员已同意相关权限；否则返回清楚的未授权提示，请改用 list_teams_chats。',
  z.object({}).strict(),
  async () => {
    assertSignedIn();
    try {
      const items = await listJoinedTeams();
      return { items, freshness: freshness('realtime'), coverage: coverage('teams_joined', true) };
    } catch (error) {
      asToolError(error);
    }
  },
);

export const teamsTools = {
  ...teamsArchiveTools,
  list_teams_chats: listTeamsChatsTool,
  read_teams_messages: readTeamsMessagesTool,
  list_teams_channels: listTeamsChannelsTool,
};
