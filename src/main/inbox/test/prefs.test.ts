import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => store.get(key),
  writeSetting: (key: string, value: string) => store.set(key, value),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../storage', () => ({ storageDirectory: () => '/tmp/dtqd-test' }));
vi.mock('../sources', () => ({}));
vi.mock('../engine', () => ({}));
vi.mock('../../notifications/system', () => ({ isWorkspaceWindow: () => true }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
import { inboxPrefs, setInboxPrefs } from '../prefs';
import { mergePending } from '..';

beforeEach(() => store.clear());

describe('inboxPrefs', () => {
  it('默认开启 AI 提取、五个兴趣全选、未看过说明', () => {
    expect(inboxPrefs()).toEqual({
      aiExtract: true,
      interests: ['实习', '保研', '竞赛', '出国', '考研'],
      noticeAcknowledged: false,
    });
  });

  it('部分更新只改传入的字段；损坏的值回退默认', () => {
    setInboxPrefs({ aiExtract: false });
    expect(inboxPrefs()).toMatchObject({ aiExtract: false, noticeAcknowledged: false });
    setInboxPrefs({ interests: ['保研'] });
    expect(inboxPrefs()).toMatchObject({ aiExtract: false, interests: ['保研'] });
    store.set('inbox-prefs', '{坏');
    expect(inboxPrefs().aiExtract).toBe(true);
  });

  it('非法输入报错', () => {
    expect(() => setInboxPrefs({ aiExtract: 'yes' })).toThrow();
  });
});

describe('mergePending', () => {
  it('同一来源的待提取内容合并，空的丢掉，按来源顺序', () => {
    expect(
      mergePending(
        [{ source: 'qq', text: 'old qq' }],
        [
          { source: 'qq', text: 'new qq' },
          { source: 'teams', text: 'teams' },
          { source: 'outlook', text: '  ' },
        ],
      ),
    ).toEqual([
      { source: 'teams', text: 'teams' },
      { source: 'qq', text: 'old qq\n\nnew qq' },
    ]);
  });

  it('超长时只留最新的部分', () => {
    const [merged] = mergePending(
      [{ source: 'teams', text: 'a'.repeat(130000) }],
      [{ source: 'teams', text: 'END' }],
    );
    expect(merged!.text.length).toBe(120000);
    expect(merged!.text.endsWith('END')).toBe(true);
  });
});
