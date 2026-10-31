// Teams（Microsoft Graph）响应解析与错误提示：聊天列表、消息 HTML 转文本、分页游标与 403 管理员同意。
import { describe, expect, it, vi } from 'vitest';

vi.mock('../microsoft', () => ({ getMicrosoftAccessToken: vi.fn(async () => 'token') }));

import {
  explainGraphError,
  htmlToText,
  listTeamsChannelMessages,
  listTeamsChatMessages,
  listTeamsChats,
  parseChats,
  parseMessages,
  safeNextLink,
  type GraphFetch,
} from '../graph';

function graphFetch(status: number, body: unknown) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl: GraphFetch = async (url, init) => {
    urls.push(url);
    headers.push(init.headers);
    return { status, json: async () => body };
  };
  return { fetchImpl, urls, headers };
}

const chatsBody = {
  value: [
    {
      id: '19:old@thread.v2',
      topic: 'Maths 2B',
      chatType: 'group',
      lastUpdatedDateTime: '2026-10-01T08:00:00Z',
      webUrl: 'https://teams.microsoft.com/l/chat/old',
      members: [{ displayName: 'Alice' }, { displayName: null }],
    },
    {
      id: '19:new@unq.gbl.spaces',
      topic: null,
      chatType: 'oneOnOne',
      lastUpdatedDateTime: '2026-10-30T08:00:00Z',
      members: [{ displayName: 'Bob' }],
    },
    { notAChat: true },
  ],
};

describe('parseChats', () => {
  it('按最近更新排序，丢弃无法识别的项，成员名去空', () => {
    const chats = parseChats(chatsBody);
    expect(chats.map((chat) => chat.id)).toEqual(['19:new@unq.gbl.spaces', '19:old@thread.v2']);
    expect(chats[1]).toEqual({
      id: '19:old@thread.v2',
      topic: 'Maths 2B',
      chatType: 'group',
      members: ['Alice'],
      lastUpdatedAt: '2026-10-01T08:00:00Z',
      lastMessage: null,
      webUrl: 'https://teams.microsoft.com/l/chat/old',
    });
    expect(chats[0]).toMatchObject({ topic: null, members: ['Bob'], webUrl: null });
  });

  it('有最后消息预览时按消息时间排序，并给出发送人与纯文本', () => {
    const chats = parseChats({
      value: [
        {
          id: 'renamed-recently',
          topic: 'Old group',
          lastUpdatedDateTime: '2026-10-30T00:00:00Z',
          lastMessagePreview: { createdDateTime: '2026-09-01T00:00:00Z', body: { content: 'x' } },
        },
        {
          id: 'active',
          topic: 'Physics',
          lastUpdatedDateTime: '2026-01-01T00:00:00Z',
          lastMessagePreview: {
            createdDateTime: '2026-10-29T00:00:00Z',
            from: { user: { displayName: 'TA' } },
            body: { contentType: 'html', content: '<p>Lab moved to <b>Room 2</b></p>' },
          },
        },
      ],
    });
    expect(chats.map((chat) => chat.id)).toEqual(['active', 'renamed-recently']);
    expect(chats[0]!.lastMessage).toEqual({
      from: 'TA',
      text: 'Lab moved to Room 2',
      createdAt: '2026-10-29T00:00:00Z',
    });
  });
});

describe('parseMessages', () => {
  it('HTML 正文转纯文本、取发送人、跳过已删除消息、保留附件名', () => {
    const { items, nextLink } = parseMessages({
      value: [
        {
          id: '1',
          createdDateTime: '2026-10-30T09:00:00Z',
          messageType: 'message',
          from: { user: { displayName: 'Dr Smith' } },
          body: {
            contentType: 'html',
            content: '<p>Assignment&nbsp;1 due <b>Friday</b></p><p>Tom &amp; Jerry&#39;s</p>',
          },
          attachments: [{ name: 'brief.pdf' }],
        },
        {
          id: '2',
          deletedDateTime: '2026-10-30T10:00:00Z',
          body: { contentType: 'text', content: 'gone' },
        },
        {
          id: '3',
          messageType: 'systemEventMessage',
          from: null,
          body: { contentType: 'text', content: '  plain  ' },
        },
      ],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/chats/x/messages?$skiptoken=abc',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: '1',
      createdAt: '2026-10-30T09:00:00Z',
      from: 'Dr Smith',
      text: "Assignment 1 due Friday\nTom & Jerry's",
      messageType: 'message',
      attachments: ['brief.pdf'],
      webUrl: null,
    });
    expect(items[1]).toMatchObject({
      from: null,
      text: 'plain',
      messageType: 'systemEventMessage',
    });
    expect(nextLink).toBe('https://graph.microsoft.com/v1.0/chats/x/messages?$skiptoken=abc');
  });

  it('空响应安全返回空列表', () => {
    expect(parseMessages(null)).toEqual({ items: [], nextLink: null });
  });
});

describe('htmlToText / safeNextLink', () => {
  it('换行标签转换行，数字实体解码', () => {
    expect(htmlToText('a<br>b<div>c</div>&#x4e2d;&#25991;')).toBe('a\nbc\n中文');
  });

  it('只接受 Graph v1.0 自身的 nextLink，防止令牌被带去别处', () => {
    expect(safeNextLink('https://evil.example.com/v1.0/x')).toBeNull();
    expect(safeNextLink('https://graph.microsoft.com.evil.com/v1.0/x')).toBeNull();
    expect(safeNextLink(42)).toBeNull();
  });
});

describe('Graph 请求', () => {
  it('列聊天：按最后消息排序请求，无主题聊天补成员名，成员请求失败不影响列表', async () => {
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const fetchImpl: GraphFetch = async (url, init) => {
      urls.push(url);
      headers.push(init.headers);
      if (url.includes('/members')) {
        return { status: 200, json: async () => ({ value: [{ displayName: 'Carol' }] }) };
      }
      return { status: 200, json: async () => chatsBody };
    };
    const chats = await listTeamsChats(10, { fetchImpl, token: async () => 'graph-at' });
    expect(urls[0]).toBe(
      'https://graph.microsoft.com/v1.0/me/chats?$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime%20desc&$top=10',
    );
    expect(headers[0]!.Authorization).toBe('Bearer graph-at');
    // 只有无主题的 1:1 聊天去拉成员。
    expect(urls.slice(1)).toEqual([
      'https://graph.microsoft.com/v1.0/chats/19%3Anew%40unq.gbl.spaces/members',
    ]);
    expect(chats.map((chat) => chat.members)).toEqual([['Carol'], ['Alice']]);

    const failing: GraphFetch = async (url) =>
      url.includes('/members')
        ? { status: 403, json: async () => ({}) }
        : { status: 200, json: async () => chatsBody };
    const fallback = await listTeamsChats(10, { fetchImpl: failing, token: async () => 't' });
    expect(fallback[0]!.members).toEqual(['Bob']);
  });

  it('读聊天消息：chatId 编码进路径，cursor 原样请求', async () => {
    const { fetchImpl, urls } = graphFetch(200, { value: [] });
    await listTeamsChatMessages('19:a/b@thread.v2', 5, { fetchImpl });
    expect(urls[0]).toBe(
      'https://graph.microsoft.com/v1.0/chats/19%3Aa%2Fb%40thread.v2/messages?$top=5',
    );
    const cursor = 'https://graph.microsoft.com/v1.0/chats/x/messages?$skiptoken=1';
    await listTeamsChatMessages('x', 5, { fetchImpl }, cursor);
    expect(urls[1]).toBe(cursor);
    await expect(
      listTeamsChatMessages('x', 5, { fetchImpl }, 'https://evil.example.com/'),
    ).rejects.toThrow(/游标无效/);
  });

  it('频道消息 403 → 提示需管理员同意 ChannelMessage.Read.All', async () => {
    const { fetchImpl } = graphFetch(403, {
      error: { code: 'Forbidden', message: 'Missing scope' },
    });
    await expect(listTeamsChannelMessages('t', 'c', 5, { fetchImpl })).rejects.toMatchObject({
      name: 'MicrosoftAuthError',
      code: 'Forbidden',
      message: expect.stringContaining('管理员同意'),
    });
  });

  it('其他状态码的中文提示', () => {
    expect(explainGraphError(401, null, 'graph').message).toMatch(/重新登录/);
    expect(explainGraphError(404, null, 'graph').code).toBe('NotFound');
    expect(explainGraphError(429, null, 'graph').message).toMatch(/频繁/);
    expect(explainGraphError(500, { error: { message: 'boom' } }, 'graph').message).toContain(
      'boom',
    );
  });
});
