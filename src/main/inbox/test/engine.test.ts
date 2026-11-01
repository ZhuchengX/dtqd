import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/pi', () => ({ resolveModel: vi.fn(async () => ({ model: {} })) }));
vi.mock('../../agent/providers', () => ({ usableLlmProviders: vi.fn(() => []) }));
vi.mock('../../todo', () => ({ addNoticedTodo: vi.fn() }));
vi.mock('@earendil-works/pi-ai/compat', () => ({ completeSimple: vi.fn() }));
import { completeSimple } from '@earendil-works/pi-ai/compat';
import { usableLlmProviders } from '../../agent/providers';
import { addNoticedTodo } from '../../todo';
import {
  dedupeItems,
  inboxKey,
  inboxMarkdown,
  inboxPrompt,
  isImportant,
  parseInboxItems,
  todoNotes,
  todoTitle,
  triageInbox,
  triageModel,
  type InboxItem,
} from '../engine';

const NOW = Date.parse('2026-10-31T12:00:00+08:00');

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    kind: 'deadline',
    importance: 'high',
    why: '占期末 20%',
    source: 'teams',
    course: 'DI12006',
    title: 'DI12006 作业 3 提交',
    dueAt: '2026-11-05T15:59:00.000Z',
    conversation: 'DI12006 - Statistics › General',
    detail: '在 My Dundee 提交 PDF',
    ...overrides,
  };
}

describe('parseInboxItems', () => {
  it('从代码块包裹的回复里取出条目，时间统一成 UTC，课程代码大写，缺省字段补默认', () => {
    const text =
      '```json\n{"items":[{"kind":"deadline","title":"交作业","course":"di12006","dueAt":"2026-11-05T23:59:00+08:00"}]}\n```';
    expect(parseInboxItems(text)).toEqual([
      {
        kind: 'deadline',
        title: '交作业',
        dueAt: '2026-11-05T15:59:00.000Z',
        importance: 'medium',
        why: '',
        source: 'teams',
        course: 'DI12006',
        conversation: '',
        detail: '',
      },
    ]);
  });

  it('丢掉坏条目；无法解析的时间当作没有截止；未知来源回落 teams', () => {
    const items = parseInboxItems(
      JSON.stringify({
        items: [
          { kind: 'gossip', title: '闲聊' },
          { kind: 'deadline', title: '报名', dueAt: '下周五', source: 'wechat' },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ title: '报名', dueAt: null, source: 'teams' });
  });

  it('不是 JSON 时返回 null', () => {
    expect(parseInboxItems('没有找到')).toBeNull();
    expect(parseInboxItems('{"foo":1}')).toBeNull();
  });
});

describe('去重', () => {
  it('同一门课同一天截止，不同来源、不同措辞算同一件事', () => {
    const teams = item({ source: 'teams', title: '交统计作业' });
    const mail = item({
      source: 'outlook',
      title: 'DI12006 Assignment 3 提交',
      dueAt: '2026-11-05T10:00:00.000Z',
    });
    expect(inboxKey(teams)).toBe(inboxKey(mail));
    expect(dedupeItems([mail, teams])).toEqual([mail]);
  });

  it('不同课程或不同日期不算重复；没有课程代码时按标题', () => {
    expect(inboxKey(item())).not.toBe(inboxKey(item({ course: 'DI12005' })));
    expect(inboxKey(item())).not.toBe(inboxKey(item({ dueAt: '2026-11-07T15:59:00.000Z' })));
    expect(inboxKey(item({ course: '', title: 'A' }))).not.toBe(
      inboxKey(item({ course: '', title: 'B' })),
    );
  });
});

describe('isImportant / 待办文字 / 模型', () => {
  it('high 都留；medium 只留有截止或等回复的；low 与过期的不留', () => {
    expect(isImportant(item(), NOW)).toBe(true);
    expect(isImportant(item({ dueAt: '2026-10-01T00:00:00.000Z' }), NOW)).toBe(false);
    expect(isImportant(item({ kind: 'notice', dueAt: null }), NOW)).toBe(true);
    expect(isImportant(item({ kind: 'notice', importance: 'medium', dueAt: null }), NOW)).toBe(
      false,
    );
    expect(isImportant(item({ kind: 'reply', importance: 'medium', dueAt: null }), NOW)).toBe(true);
    expect(isImportant(item({ importance: 'low' }), NOW)).toBe(false);
  });

  it('标题带类型前缀，备注首行是来源与为什么重要', () => {
    expect(todoTitle(item())).toBe('DI12006 作业 3 提交');
    expect(todoTitle(item({ kind: 'reply', title: '回老师邮件' }))).toBe('回复：回老师邮件');
    expect(todoTitle(item({ kind: 'notice', title: '补考安排' }))).toBe('知悉：补考安排');
    expect(todoNotes(item())).toBe(
      'Teams · DI12006 - Statistics › General · 占期末 20%\n在 My Dundee 提交 PDF\nAI 提取，以原始通知为准',
    );
  });

  it('优先用名字带 flash 的模型', () => {
    expect(triageModel(['deepseek-v4-pro', 'deepseek-v4-flash'])).toBe('deepseek-v4-flash');
    expect(triageModel(['glm-5'])).toBe('glm-5');
    expect(triageModel([])).toBeUndefined();
  });
});

describe('inboxPrompt / inboxMarkdown', () => {
  it('提示里带当前时间、在读课程、兴趣与各来源正文', () => {
    const prompt = inboxPrompt(
      [
        { source: 'teams', text: 'hello teams' },
        { source: 'mydundee', text: 'hello bb' },
      ],
      { courses: ['DI12006 Statistics'], interests: ['实习', '保研'] },
      '2026-10-31 12:00',
    );
    expect(prompt).toContain('2026-10-31 12:00');
    expect(prompt).toContain('DI12006 Statistics');
    expect(prompt).toContain('实习、保研');
    expect(prompt).toContain('## 来源：teams');
    expect(prompt).toContain('hello bb');
  });

  it('没有课程与兴趣时不写那两段；总长度超限截断', () => {
    const prompt = inboxPrompt(
      [{ source: 'teams', text: 'x'.repeat(70000) }],
      { courses: [], interests: [] },
      'now',
    );
    expect(prompt).not.toContain('在读课程');
    expect(prompt).not.toContain('关心的方向');
    expect(prompt).toContain('已截断');
  });

  it('按类型分组，截止日期按时间排序，写出来源', () => {
    const md = inboxMarkdown(
      [
        item({ title: '后交', dueAt: '2026-11-09T00:00:00.000Z' }),
        item({ title: '先交', dueAt: '2026-11-02T00:00:00.000Z', source: 'mydundee' }),
        item({ kind: 'notice', title: '成绩发布', dueAt: null, conversation: '' }),
      ],
      NOW,
    );
    expect(md).toContain('## 截止日期（2）');
    expect(md).toContain('## 通知（1）');
    expect(md).toContain('myDundee 公告');
    expect(md.indexOf('先交')).toBeLessThan(md.indexOf('后交'));
    expect(inboxMarkdown([], NOW)).toContain('没有需要处理的事');
  });
});

describe('triageInbox', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'inbox-'));
    vi.mocked(addNoticedTodo).mockClear();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const profile = { courses: [], interests: [] };

  it('没配模型时返回 no-model，不写文件', async () => {
    vi.mocked(usableLlmProviders).mockReturnValue([]);
    await expect(triageInbox(dir, [{ source: 'teams', text: 'x' }], profile)).resolves.toEqual({
      status: 'no-model',
      items: [],
      todos: 0,
      model: null,
    });
  });

  it('建待办并记住，跨来源同一件事只建一次，第二次不重复建', async () => {
    vi.mocked(usableLlmProviders).mockReturnValue([
      {
        id: 'p',
        name: 'p',
        baseUrl: 'https://x/v1',
        apiKey: 'k',
        models: ['m-pro', 'm-flash'],
        enabled: true,
      },
    ] as never);
    const future = new Date(Date.now() + 86400000).toISOString();
    vi.mocked(completeSimple).mockResolvedValue({
      stopReason: 'stop',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            items: [
              {
                kind: 'deadline',
                importance: 'high',
                source: 'mydundee',
                course: 'DI12006',
                title: '交作业',
                dueAt: future,
                why: '占 20%',
                conversation: 'Stats',
              },
              {
                kind: 'deadline',
                importance: 'high',
                source: 'teams',
                course: 'DI12006',
                title: '统计作业截止',
                dueAt: future,
              },
              { kind: 'notice', importance: 'medium', title: '讲座宣传' },
            ],
          }),
        },
      ],
    } as never);
    const first = await triageInbox(dir, [{ source: 'teams', text: 'x' }], profile);
    expect(first).toMatchObject({ status: 'ok', todos: 1, model: 'm-flash' });
    expect(addNoticedTodo).toHaveBeenCalledWith({
      title: '交作业',
      notes: 'myDundee 公告 · Stats · 占 20%\nAI 提取，以原始通知为准',
      dueAt: future,
      calendar: true,
    });
    const md = await readFile(join(dir, '待办提取.md'), 'utf8');
    expect(md).toContain('为什么重要：占 20%');
    expect(md).not.toContain('讲座宣传');
    const second = await triageInbox(dir, [{ source: 'teams', text: 'x' }], profile);
    expect(second).toMatchObject({ status: 'ok', todos: 0 });
    expect(addNoticedTodo).toHaveBeenCalledTimes(1);
  });

  it('回复解析不出 JSON 时返回 failed', async () => {
    vi.mocked(usableLlmProviders).mockReturnValue([
      { id: 'p', name: 'p', baseUrl: 'https://x/v1', apiKey: 'k', models: ['m'], enabled: true },
    ] as never);
    vi.mocked(completeSimple).mockResolvedValue({
      stopReason: 'stop',
      content: [{ type: 'text', text: '抱歉' }],
    } as never);
    await expect(triageInbox(dir, [{ source: 'qq', text: 'x' }], profile)).resolves.toMatchObject({
      status: 'failed',
      model: 'm',
    });
  });
});
