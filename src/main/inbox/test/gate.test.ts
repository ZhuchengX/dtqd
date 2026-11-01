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
  rename: async (from: string, to: string) => void files.set(to, files.get(from) ?? ''),
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

import { runInbox } from '..';
import { setInboxPrefs } from '../prefs';

const read = (source: string) => ({
  source,
  status: 'ok',
  newItems: 1,
  text: `${source} 新内容`,
  detail: null,
  cursor: `${source}-cursor`,
});

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
  triageInbox.mockResolvedValue({ status: 'ok', items: [], todos: 0, model: 'model' });
});

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

  it('校内办公网和 Teams 私聊默认不读入提取', async () => {
    setInboxPrefs({ aiExtract: true });
    await runInbox();
    expect(sources.readTeams).toHaveBeenCalledWith(false);
    expect(sources.readCampusWeb.mock.calls[0]![2]).toBe(false);
  });
});
