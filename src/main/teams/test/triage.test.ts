import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/pi', () => ({ resolveModel: vi.fn(async () => ({ model: {} })) }));
vi.mock('../../agent/providers', () => ({ usableLlmProviders: vi.fn(() => []) }));
vi.mock('../../todo', () => ({ saveTodo: vi.fn() }));
vi.mock('@earendil-works/pi-ai/compat', () => ({ completeSimple: vi.fn() }));
import { completeSimple } from '@earendil-works/pi-ai/compat';
import { usableLlmProviders } from '../../agent/providers';
import { saveTodo } from '../../todo';
import {
  parseTriage,
  triageKey,
  triageMarkdown,
  triagePrompt,
  triageTeamsDigest,
  wantsTodo,
  type TeamsTriageItem,
} from '../triage';

const NOW = Date.parse('2026-10-31T12:00:00+08:00');

function item(overrides: Partial<TeamsTriageItem> = {}): TeamsTriageItem {
  return {
    kind: 'deadline',
    title: 'DI12006 作业 3 提交',
    dueAt: '2026-11-05T15:59:00.000Z',
    conversation: 'DI12006 - Statistics › General',
    detail: '在 My Dundee 提交 PDF',
    ...overrides,
  };
}

describe('parseTriage', () => {
  it('从代码块包裹的回复里取出条目，时间统一成 UTC', () => {
    const text =
      '```json\n{"items":[{"kind":"deadline","title":"交作业","dueAt":"2026-11-05T23:59:00+08:00","conversation":"Stats","detail":"x"}]}\n```';
    expect(parseTriage(text)).toEqual([
      {
        kind: 'deadline',
        title: '交作业',
        dueAt: '2026-11-05T15:59:00.000Z',
        conversation: 'Stats',
        detail: 'x',
      },
    ]);
  });

  it('丢掉坏条目，保留其余；无法解析的时间当作没有截止', () => {
    const text = JSON.stringify({
      items: [
        { kind: 'gossip', title: '闲聊' },
        { kind: 'notice', title: '成绩已发布' },
        { kind: 'deadline', title: '报名', dueAt: '下周五' },
      ],
    });
    expect(parseTriage(text)).toEqual([
      { kind: 'notice', title: '成绩已发布', dueAt: null, conversation: '', detail: '' },
      { kind: 'deadline', title: '报名', dueAt: null, conversation: '', detail: '' },
    ]);
  });

  it('不是 JSON 时返回 null', () => {
    expect(parseTriage('没有找到')).toBeNull();
    expect(parseTriage('{"foo":1}')).toBeNull();
  });
});

describe('wantsTodo / triageKey', () => {
  it('通知不进待办，过期截止不进待办，待回复进待办', () => {
    expect(wantsTodo(item(), NOW)).toBe(true);
    expect(wantsTodo(item({ dueAt: '2026-10-01T00:00:00.000Z' }), NOW)).toBe(false);
    expect(wantsTodo(item({ kind: 'notice', dueAt: null }), NOW)).toBe(false);
    expect(wantsTodo(item({ kind: 'reply', dueAt: null }), NOW)).toBe(true);
  });

  it('同一件事 key 相同，截止时间不同 key 不同', () => {
    expect(triageKey(item())).toBe(triageKey(item({ detail: '别的说明' })));
    expect(triageKey(item())).not.toBe(triageKey(item({ dueAt: null })));
  });
});

describe('triagePrompt / triageMarkdown', () => {
  it('提示里带当前时间与消息正文，过长截断', () => {
    const prompt = triagePrompt('# Teams 最近更新\n\nhello', NOW);
    expect(prompt).toContain('2026-10-31 12:00');
    expect(prompt).toContain('hello');
    expect(triagePrompt('x'.repeat(70000), NOW)).toContain('已截断');
  });

  it('按类型分组，截止日期按时间排序', () => {
    const md = triageMarkdown(
      [
        item({ title: '后交', dueAt: '2026-11-09T00:00:00.000Z' }),
        item({ title: '先交', dueAt: '2026-11-02T00:00:00.000Z' }),
        item({ kind: 'notice', title: '成绩发布', dueAt: null, conversation: '' }),
      ],
      NOW,
    );
    expect(md).toContain('## 截止日期（2）');
    expect(md).toContain('## 通知（1）');
    expect(md.indexOf('先交')).toBeLessThan(md.indexOf('后交'));
    expect(triageMarkdown([], NOW)).toContain('没有需要处理的事');
  });
});

describe('triageTeamsDigest', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'teams-triage-'));
    await writeFile(join(dir, '最近更新.md'), '# Teams 最近更新\n');
    vi.mocked(saveTodo).mockClear();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('没配模型时跳过，不写文件', async () => {
    vi.mocked(usableLlmProviders).mockReturnValue([]);
    await expect(triageTeamsDigest(dir)).resolves.toEqual({
      status: 'no-model',
      items: [],
      todos: 0,
    });
  });

  it('建待办并记住，第二次同一件事不重复建', async () => {
    vi.mocked(usableLlmProviders).mockReturnValue([
      { id: 'p', name: 'p', baseUrl: 'https://x/v1', apiKey: 'k', models: ['m'], enabled: true },
    ] as never);
    const future = new Date(Date.now() + 86400000).toISOString();
    vi.mocked(completeSimple).mockResolvedValue({
      stopReason: 'stop',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            items: [
              { kind: 'deadline', title: '交作业', dueAt: future, conversation: 'Stats' },
              { kind: 'notice', title: '成绩发布' },
            ],
          }),
        },
      ],
    } as never);
    const first = await triageTeamsDigest(dir);
    expect(first).toMatchObject({ status: 'ok', todos: 1 });
    expect(saveTodo).toHaveBeenCalledWith({
      title: '交作业',
      notes: '来自 Teams · Stats',
      dueAt: future,
    });
    expect(await readFile(join(dir, '待办提取.md'), 'utf8')).toContain('成绩发布');
    const second = await triageTeamsDigest(dir);
    expect(second).toMatchObject({ status: 'ok', todos: 0 });
    expect(saveTodo).toHaveBeenCalledTimes(1);
  });
});
