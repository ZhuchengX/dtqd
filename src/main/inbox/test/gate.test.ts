import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const files = new Map<string, string>();
const sources = vi.hoisted(() => ({
  readTeams: vi.fn(),
  readOutlook: vi.fn(),
  readOutlookWeb: vi.fn(),
  readMyDundee: vi.fn(),
  readCampusWeb: vi.fn(),
  readQq: vi.fn(),
}));
const triageInbox = vi.hoisted(() => vi.fn());
const accepted = vi.hoisted(() => ({ value: true }));

vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => store.get(key),
  writeSetting: (key: string, value: string) => store.set(key, value),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('node:fs/promises', () => ({
  mkdir: async () => undefined,
  readFile: async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error('missing');
    return text;
  },
  writeFile: async (path: string, text: string) => void files.set(path, text),
  rename: async (from: string, to: string) => {
    const text = files.get(from);
    if (text === undefined) throw new Error('ENOENT');
    files.set(to, text);
    files.delete(from);
  },
}));
vi.mock('../../storage', () => ({ storageDirectory: () => '/tmp/dtqd-test' }));
vi.mock('../../campus', () => ({}));
vi.mock('../../consent', () => ({ termsAccepted: () => accepted.value }));
vi.mock('../../notifications/system', () => ({ isWorkspaceWindow: () => true }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../outlook-web/store', () => ({ outlookWebConnected: () => false }));
vi.mock('../notice-archive', () => ({ refreshNoticeArchive: vi.fn() }));
vi.mock('../campus-web', () => ({ CAMPUS_OFFICE_URL: '' }));
vi.mock('../engine', () => ({ configuredTriageModel: () => 'model', triageInbox }));
vi.mock('../sources', () => ({
  ...sources,
  currentCourses: async () => [],
  readCursors: () => JSON.parse(store.get('cursors') ?? '{}'),
  saveCursors: (cursors: unknown) => store.set('cursors', JSON.stringify(cursors)),
}));

import { forgetInboxSources, mergePending, registerInboxIpc, runInbox } from '..';
import { setInboxPrefs } from '../prefs';

const read = (source: string) => ({
  source,
  status: 'ok',
  newItems: 1,
  text: `${source} 新内容`,
  detail: null,
  cursor: `${source}-cursor`,
});
const PENDING = '/tmp/dtqd-test/重要事项/.pending.json';
const pendingInputs = () =>
  JSON.parse(files.get(PENDING) ?? '[]') as { source: string; text: string; private?: boolean }[];
const sentInputs = () =>
  triageInbox.mock.calls[0]![1] as { source: string; text: string; private?: boolean }[];
const teamsRead = { ...read('teams'), text: '群聊内容', privateText: '私聊内容' };

beforeEach(() => {
  store.clear();
  files.clear();
  accepted.value = true;
  vi.clearAllMocks();
  sources.readTeams.mockResolvedValue(read('teams'));
  sources.readOutlook.mockReturnValue(read('outlook'));
  sources.readMyDundee.mockReturnValue(read('mydundee'));
  sources.readCampusWeb.mockResolvedValue(read('campus'));
  sources.readQq.mockResolvedValue(read('qq'));
  triageInbox.mockResolvedValue({ status: 'ok', items: [], todos: 0, model: 'model', rest: [] });
});

async function prefsHandler(): Promise<(event: unknown, patch: unknown) => Promise<unknown>> {
  const { ipcMain } = await import('electron');
  registerInboxIpc();
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'inbox:set-prefs');
  return call![1] as never;
}

describe('重要事项门控', () => {
  it('未接受当前条款时不读取任何来源', async () => {
    accepted.value = false;
    await runInbox();
    expect(sources.readQq).not.toHaveBeenCalled();
    expect(sources.readCampusWeb).not.toHaveBeenCalled();
  });

  it('默认不发给模型，不积压，也不写入首次回看的游标', async () => {
    const state = await runInbox();
    expect(triageInbox).not.toHaveBeenCalled();
    expect(state.lastRun?.status).toBe('off');
    expect(files.get('/tmp/dtqd-test/重要事项/.pending.json')).toBe('[]');
    expect(JSON.parse(store.get('cursors') ?? '{}')).toEqual({});
  });

  it('关闭的来源不读取、不发送；开启提取后才发送其余来源', async () => {
    setInboxPrefs({
      aiExtract: true,
      sources: { teams: true, outlook: true, mydundee: true, campus: true, qq: false },
    });
    await runInbox();
    expect(sources.readQq).not.toHaveBeenCalled();
    const inputs = triageInbox.mock.calls[0]![1] as { source: string }[];
    expect(inputs.map((input) => input.source)).toEqual(['teams', 'outlook', 'mydundee', 'campus']);
  });

  it('校内办公网和 Teams 私聊默认不进入提取', async () => {
    sources.readTeams.mockResolvedValue(teamsRead);
    setInboxPrefs({ aiExtract: true });
    await runInbox();
    expect(sources.readCampusWeb.mock.calls[0]![2]).toBe(false);
    expect(sentInputs().some((input) => input.text.includes('私聊内容'))).toBe(false);
    expect(pendingInputs().some((input) => input.text.includes('私聊内容'))).toBe(false);
  });

  it('开启私聊后才发送，并单独标记', async () => {
    sources.readTeams.mockResolvedValue(teamsRead);
    setInboxPrefs({ aiExtract: true, teamsPrivate: true });
    await runInbox();
    expect(sentInputs()).toContainEqual({ source: 'teams', text: '私聊内容', private: true });
  });
});

describe('读取和提取期间改开关', () => {
  it('读取途中关掉私聊：只发群聊', async () => {
    setInboxPrefs({ aiExtract: true, teamsPrivate: true });
    sources.readTeams.mockImplementation(async () => {
      setInboxPrefs({ teamsPrivate: false });
      return teamsRead;
    });
    await runInbox();
    expect(sentInputs().map((input) => input.text)).toContain('群聊内容');
    expect(sentInputs().some((input) => input.text.includes('私聊内容'))).toBe(false);
  });

  it('读取途中打开私聊：按最新开关发送', async () => {
    setInboxPrefs({ aiExtract: true, teamsPrivate: false });
    sources.readTeams.mockImplementation(async () => {
      setInboxPrefs({ teamsPrivate: true });
      return teamsRead;
    });
    await runInbox();
    expect(sentInputs().some((input) => input.text.includes('私聊内容'))).toBe(true);
  });

  it('提取途中关掉私聊且提取失败：私聊不写回队列，群聊保留', async () => {
    setInboxPrefs({ aiExtract: true, teamsPrivate: true });
    sources.readTeams.mockResolvedValue(teamsRead);
    triageInbox.mockImplementation(async () => {
      setInboxPrefs({ teamsPrivate: false });
      return { status: 'failed', items: [], todos: 0, model: 'model' };
    });
    await runInbox();
    const texts = pendingInputs().map((input) => input.text);
    expect(texts).toContain('群聊内容');
    expect(texts).not.toContain('私聊内容');
  });

  it('队列里的私聊内容在开关关闭后不发送', async () => {
    files.set(PENDING, JSON.stringify([{ source: 'teams', text: '旧私聊', private: true }]));
    setInboxPrefs({ aiExtract: true, teamsPrivate: false });
    await runInbox();
    expect(sentInputs().some((input) => input.text.includes('旧私聊'))).toBe(false);
  });

  it('提取途中关掉来源：提取失败也不写回', async () => {
    setInboxPrefs({ aiExtract: true });
    triageInbox.mockImplementation(async () => {
      setInboxPrefs({
        sources: { teams: true, outlook: false, mydundee: true, campus: true, qq: true },
      });
      return { status: 'failed', items: [], todos: 0, model: 'model' };
    });
    await runInbox();
    expect(pendingInputs().map((input) => input.source)).not.toContain('outlook');
  });
});

describe('待提取队列', () => {
  it('发给模型前先落盘：提取中途退出也不丢内容', async () => {
    setInboxPrefs({ aiExtract: true });
    let queued: { source: string }[] = [];
    triageInbox.mockImplementation(async () => {
      queued = pendingInputs();
      return { status: 'ok', items: [], todos: 0, model: 'model', rest: [] };
    });
    await runInbox();
    expect(queued.map((input) => input.source)).toContain('mydundee');
    expect(pendingInputs()).toEqual([]);
  });

  it('提取成功只移除已发送的部分，超预算没发的留到下次', async () => {
    setInboxPrefs({ aiExtract: true });
    triageInbox.mockResolvedValue({
      status: 'ok',
      items: [],
      todos: 0,
      model: 'model',
      rest: [{ source: 'teams', text: '更早的消息' }],
    });
    await runInbox();
    expect(pendingInputs()).toEqual([{ source: 'teams', text: '更早的消息' }]);
  });

  it('并发写队列按顺序执行：改设置不会用旧快照盖掉新内容', async () => {
    setInboxPrefs({ aiExtract: true });
    const setPrefs = await prefsHandler();
    let change: Promise<unknown> = Promise.resolve();
    let queued: { source: string }[] = [];
    triageInbox.mockImplementation(async () => {
      queued = pendingInputs();
      return { status: 'failed', items: [], todos: 0, model: 'model' };
    });
    sources.readQq.mockImplementation(async () => {
      change = setPrefs({}, { interests: ['AI'] });
      return read('qq');
    });
    await runInbox();
    await change;
    expect(queued.map((input) => input.source)).toContain('qq');
    expect(pendingInputs().map((input) => input.source)).toContain('qq');
    expect(files.has(`${PENDING}.tmp`)).toBe(false);
  });

  it('发送前的复核：开关变了就不算允许，内容按新开关写回', async () => {
    setInboxPrefs({ aiExtract: true });
    triageInbox.mockImplementation(async (_dir, _inputs, _profile, stillAllowed) => {
      expect(stillAllowed()).toBe(true);
      setInboxPrefs({ aiExtract: false });
      expect(stillAllowed()).toBe(false);
      return { status: 'withdrawn', items: [], todos: 0, model: null, rest: [] };
    });
    const state = await runInbox();
    expect(state.lastRun?.status).toBe('withdrawn');
    expect(pendingInputs()).toEqual([]);
  });

  it('读取途中关掉的来源不写游标', async () => {
    setInboxPrefs({ aiExtract: true });
    sources.readOutlook.mockImplementation(() => {
      setInboxPrefs({
        sources: { teams: true, outlook: false, mydundee: true, campus: true, qq: true },
      });
      return read('outlook');
    });
    await runInbox();
    const cursors = JSON.parse(store.get('cursors') ?? '{}') as Record<string, string>;
    expect(cursors.outlook).toBeUndefined();
    expect(cursors.mydundee).toBe('mydundee-cursor');
  });

  it('断开账号后丢弃进行中的内容、队列和游标', async () => {
    setInboxPrefs({ aiExtract: true });
    let forgotten = false;
    triageInbox.mockImplementation(async () => {
      await forgetInboxSources(['teams', 'outlook']);
      forgotten = true;
      return { status: 'failed', items: [], todos: 0, model: 'model' };
    });
    await runInbox();
    expect(forgotten).toBe(true);
    const kept = pendingInputs().map((input) => input.source);
    expect(kept).not.toContain('teams');
    expect(kept).not.toContain('outlook');
    expect(kept).toContain('mydundee');
    const cursors = JSON.parse(store.get('cursors') ?? '{}') as Record<string, string>;
    expect(cursors.outlook).toBeUndefined();
  });
});

describe('mergePending', () => {
  it('群聊和私聊分开合并，不混在一段', () => {
    expect(
      mergePending(
        [
          { source: 'teams', text: '旧群聊' },
          { source: 'teams', text: '旧私聊', private: true },
        ],
        [{ source: 'teams', text: '新群聊' }],
      ),
    ).toEqual([
      { source: 'teams', text: '旧群聊\n\n新群聊' },
      { source: 'teams', text: '旧私聊', private: true },
    ]);
  });
});
