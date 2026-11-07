// Teams 本机存档的只读 dela 命令：读 teams/ 下按会话保存的 Markdown，不联网。
// 私聊与分不清类型的会话跟随「私聊进入提取」开关，关闭时搜不到、列不出、读不了。
import { readFileSync, statSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { z } from 'zod';
import { inboxPrefs } from '../../../inbox/prefs';
import { archiveFiles, searchTeamsArchive } from '../../../search/teams-archive';
import { hasTeamsLogin, teamsDirectory } from '../../../teams/sync';
import { coverage, freshness, tool, toolError } from '../shared';

const GROUP_KINDS = new Set(['频道', '会议', '群聊']);
export const PRIVATE_HIDDEN = '私聊已隐藏：学生在 设置 › 重要事项 打开「私聊进入提取」后才能读';
const MESSAGE_HEADER = /^### (.+?) · (.*)$/;

const archiveId = (root: string, path: string) => relative(root, path).split(sep).join('/');
const kindOf = (id: string) => (id.includes('/') ? id.slice(0, id.indexOf('/')) : '');
const isGroup = (id: string) => GROUP_KINDS.has(kindOf(id));

/** 从未登录且没有存档时才算未连接；退出登录后保留的存档仍可查。 */
function archivePaths(root: string): string[] {
  const paths = archiveFiles(root);
  if (paths.length === 0 && !hasTeamsLogin())
    throw toolError('NOT_CONFIGURED', 'Teams 未连接：请学生点侧栏 Teams 登录一次，之后自动同步');
  return paths;
}

function visiblePaths(root: string): { paths: string[]; hidden: number } {
  const all = archivePaths(root);
  if (inboxPrefs().teamsPrivate) return { paths: all, hidden: 0 };
  const paths = all.filter((path) => isGroup(archiveId(root, path)));
  return { paths, hidden: all.length - paths.length };
}

const hiddenWarning = (hidden: number) => (hidden > 0 ? [PRIVATE_HIDDEN] : undefined);

/** 存档一条消息：### 时间 · 发送人，空行，正文。文件开头的 # 标题不是消息。 */
export function parseArchiveMessages(
  text: string,
): Array<{ time: string; author: string; text: string }> {
  const messages: Array<{ time: string; author: string; text: string }> = [];
  for (const line of text.split('\n')) {
    const header = MESSAGE_HEADER.exec(line);
    if (header) messages.push({ time: header[1]!, author: header[2]!, text: '' });
    else if (messages.length > 0) {
      const last = messages.at(-1)!;
      last.text = last.text ? `${last.text}\n${line}` : line;
    }
  }
  return messages.map((message) => ({ ...message, text: message.text.trim() }));
}

export const listTeamsArchiveTool = tool(
  '列出本机 Teams 存档里的会话：id、类型（频道/会议/群聊，开启私聊后含私聊）、名称、最近更新时间，最近更新的在前。只读，不联网。',
  z
    .object({
      kind: z.enum(['频道', '会议', '群聊', '私聊', '其他']).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    })
    .strict(),
  ({ kind, limit }) => {
    const root = teamsDirectory();
    const { paths, hidden } = visiblePaths(root);
    const conversations = paths
      .map((path) => {
        const id = archiveId(root, path);
        return {
          id,
          kind: kindOf(id),
          name: id.slice(id.indexOf('/') + 1).replace(/\.md$/, ''),
          updatedAt: statSync(path).mtime.toISOString(),
        };
      })
      .filter((item) => item.kind && (!kind || item.kind === kind))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      items: conversations.slice(0, limit),
      total: conversations.length,
      freshness: freshness('cached'),
      coverage: coverage('teams_archive', conversations.length <= limit, hiddenWarning(hidden)),
    };
  },
);

export const readTeamsArchiveTool = tool(
  '读本机 Teams 存档里某个会话的消息（最新在前）：id 取自 list_teams_archive 或 search_teams_archive，翻页传 offset。只读，不联网。',
  z
    .object({
      id: z.string().min(1).max(600),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),
  ({ id, limit, offset }) => {
    const root = teamsDirectory();
    const { paths, hidden } = visiblePaths(root);
    // 只认列表里的文件，id 不能走到存档目录之外。
    const path = paths.find((candidate) => archiveId(root, candidate) === id);
    if (!path) {
      if (hidden > 0 && !isGroup(id)) throw toolError('NOT_CONFIGURED', PRIVATE_HIDDEN);
      throw toolError('NOT_FOUND', '存档里没有这个会话，请先用 list_teams_archive 查 id');
    }
    const messages = parseArchiveMessages(readFileSync(path, 'utf8')).reverse();
    const end = offset + limit;
    return {
      items: messages.slice(offset, end),
      total: messages.length,
      nextOffset: end < messages.length ? end : null,
      freshness: freshness('cached', statSync(path).mtime.toISOString()),
      coverage: coverage('teams_archive_thread', end >= messages.length),
    };
  },
);

export const searchTeamsArchiveTool = tool(
  '按关键词搜本机 Teams 存档的消息和会话名，返回会话 id、标题和命中那一行。只读，不联网。',
  z
    .object({
      query: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(50).default(10),
    })
    .strict(),
  ({ query, limit }) => {
    const root = teamsDirectory();
    const { paths, hidden } = visiblePaths(root);
    const visible = new Set(paths);
    const hits = searchTeamsArchive(root, query, limit, (path) => visible.has(path));
    return {
      items: hits.map(({ path, title, snippet }) => ({
        id: archiveId(root, path),
        title,
        snippet,
      })),
      freshness: freshness('cached'),
      coverage: coverage('teams_archive_search', hits.length < limit, hiddenWarning(hidden)),
    };
  },
);

export const teamsArchiveTools = {
  list_teams_archive: listTeamsArchiveTool,
  read_teams_archive: readTeamsArchiveTool,
  search_teams_archive: searchTeamsArchiveTool,
};
