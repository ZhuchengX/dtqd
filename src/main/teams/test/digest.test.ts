import { describe, expect, it } from 'vitest';
import { buildThreads, digestMarkdown, extractionThreads, type TeamsThread } from '../digest';
import {
  conversationKind,
  htmlToText,
  mentionIndex,
  type RawTeamsConversation,
  type RawTeamsMessage,
} from '../extract';

const team: RawTeamsConversation = {
  id: '19:general@thread.tacv2',
  threadType: 'space',
  topic: 'DIICSU Maths',
  teamId: '19:general@thread.tacv2',
  lastMessageTime: 0,
};
const channel: RawTeamsConversation = {
  id: '19:ma22004@thread.tacv2',
  threadType: 'topic',
  topic: 'MA22004',
  teamId: team.id,
  lastMessageTime: 0,
};
const dm: RawTeamsConversation = {
  id: '19:a_b@unq.gbl.spaces',
  threadType: 'chat',
  topic: '',
  teamId: '',
  lastMessageTime: 0,
};

const message = (over: Partial<RawTeamsMessage>): RawTeamsMessage => ({
  conversationId: channel.id,
  replyChainId: '1',
  id: '1',
  time: Date.UTC(2026, 9, 31, 2, 0),
  author: 'Dr Smith',
  messageType: 'RichText/Html',
  content: '<p>Hello</p>',
  ...over,
});

describe('htmlToText', () => {
  it('去标签、保留换行与链接地址、解实体', () => {
    expect(
      htmlToText(
        '<p>Due <b>Fri</b>&nbsp;&amp; see <a href="https://x.y/z">notes</a></p><p>Thanks</p>',
      ),
    ).toBe('Due Fri & see notes (https://x.y/z)\nThanks');
  });
});

describe('conversationKind', () => {
  it('区分频道、私聊、群聊、会议', () => {
    expect(conversationKind(channel)).toBe('频道');
    expect(conversationKind(dm)).toBe('私聊');
    expect(conversationKind({ ...dm, id: '19:x@thread.v2', threadType: 'chat' })).toBe('群聊');
    expect(conversationKind({ ...dm, id: '19:y@thread.skype', threadType: '' })).toBe('群聊');
    expect(conversationKind({ ...dm, id: '19:meeting_abc@thread.v2', threadType: 'meeting' })).toBe(
      '会议',
    );
  });
});

describe('buildThreads', () => {
  it('频道命名为「团队 › 频道」，私聊用对方名字，跳过系统消息', () => {
    const threads = buildThreads(
      [team, channel, dm],
      [
        message({ id: '1', content: '<p>Test on Monday</p>' }),
        message({ id: '2', messageType: 'ThreadActivity/AddMember', content: 'x' }),
        message({
          id: '3',
          conversationId: dm.id,
          author: 'Alice',
          time: Date.UTC(2026, 9, 31, 3, 0),
        }),
      ],
    );
    expect(threads.map((t) => [t.kind, t.name, t.messages.length])).toEqual([
      ['私聊', 'Alice', 1],
      ['频道', 'DIICSU Maths › MA22004', 1],
    ]);
  });

  it('同一会话按时间升序', () => {
    const [thread] = buildThreads(
      [team, channel],
      [
        message({ id: '2', time: 2000, content: 'b' }),
        message({ id: '1', time: 1000, content: 'a' }),
      ],
    );
    expect(thread!.messages.map((m) => m.text)).toEqual(['a', 'b']);
  });
});

describe('digestMarkdown', () => {
  it('没有新消息时写明', () => {
    expect(digestMarkdown([], 0, Date.UTC(2026, 9, 31))).toContain('没有新消息');
  });

  it('列出会话标题与消息', () => {
    const md = digestMarkdown(
      buildThreads([team, channel], [message({})]),
      1,
      Date.UTC(2026, 9, 31, 4),
    );
    expect(md).toContain('新消息：1 条，1 个会话');
    expect(md).toContain('## [频道] DIICSU Maths › MA22004');
    expect(md).toContain('· Dr Smith');
    expect(md).toContain('Hello');
  });
});

describe('首次同步', () => {
  it('「最近更新」只含最近 14 天', () => {
    const now = Date.UTC(2026, 9, 31);
    const threads = buildThreads(
      [team, channel],
      [
        message({ id: 'old', time: now - 30 * 86400000, content: 'old news' }),
        message({ id: 'new', time: now - 86400000, content: 'fresh news' }),
      ],
    );
    const md = digestMarkdown(threads, 0, now);
    expect(md).toContain('fresh news');
    expect(md).not.toContain('old news');
    expect(md).toContain('首次同步');
  });
});

describe('@我 / 回复我', () => {
  it('动态里的 mention 与 reply 按消息 id 索引，@我 优先，点赞不要', () => {
    const index = mentionIndex([
      { type: 'reaction', conversationId: channel.id, messageId: '1', time: 1 },
      { type: 'reply', conversationId: channel.id, messageId: '2', time: 1 },
      { type: 'mention', conversationId: channel.id, messageId: '2', time: 1 },
      { type: 'replyToReply', conversationId: channel.id, messageId: '3', time: 1 },
      { type: 'mention', conversationId: channel.id, messageId: '', time: 1 },
    ]);
    expect([...index]).toEqual([
      ['2', '@我'],
      ['3', '回复我'],
    ]);
  });

  it('被 @ 的消息正文前打标', () => {
    const [thread] = buildThreads(
      [team, channel],
      [message({ id: '7', content: '<p>Please reply</p>' })],
      new Map([['7', '@我']]),
    );
    expect(thread!.messages[0]!.text).toBe('【@我】Please reply');
  });
});

describe('extractionThreads', () => {
  const thread = (kind: TeamsThread['kind']): TeamsThread => ({
    conversationId: kind,
    kind,
    name: kind,
    messages: [],
  });
  const all = [thread('频道'), thread('群聊'), thread('会议'), thread('私聊'), thread('其他')];

  it('默认不含私聊和分不清类型的会话', () => {
    expect(extractionThreads(all, false).map((item) => item.kind)).toEqual([
      '频道',
      '群聊',
      '会议',
    ]);
    expect(extractionThreads(all, true)).toHaveLength(5);
  });
});
