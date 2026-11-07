// 断开微软登录：顺序（先挡新同步、再关窗、等同步、最后清登录）、存档删除范围、IPC 参数校验。
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  root: '',
  windows: [] as { webContents: { session: unknown }; destroy: () => void }[],
  connected: true,
  rows: true,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
const teamsStub = vi.hoisted(() => ({ partition: 'teams' }));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => h.windows },
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(name, fn),
  },
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: () => h.calls.push('checked') }));
vi.mock('../../inbox', () => ({
  forgetInboxSources: async (sources: string[]) => h.calls.push(`forget:${sources.join(',')}`),
}));
vi.mock('../../outlook-web', () => ({
  outlookWebSyncSettled: async () => h.calls.push('outlook-settled'),
}));
vi.mock('../../outlook-web/store', () => ({
  clearOutlookWebConnection: (deleteRows: boolean) => {
    h.connected = false;
    if (deleteRows) h.rows = false;
    h.calls.push(`outlook-clear:${deleteRows}`);
  },
  outlookWebConnected: () => h.connected,
  outlookWebHasRows: () => h.rows,
}));
vi.mock('../calendar', () => ({ clearTeamsEvents: () => h.calls.push('calendar-clear') }));
vi.mock('../session', () => ({
  removeTeamsSnapshot: () => h.calls.push('snapshot-removed'),
  clearTeamsLogin: async () => h.calls.push('login-cleared'),
}));
vi.mock('../sync', () => ({
  hasTeamsLogin: () => h.connected,
  teamsDirectory: () => h.root,
  teamsSyncSettled: async () => h.calls.push('teams-settled'),
}));
vi.mock('../window', () => ({ teamsSession: async () => teamsStub }));

import {
  deleteTeamsArchive,
  disconnectMicrosoftWeb,
  hasTeamsArchive,
  registerMicrosoftWebDisconnectIpc,
} from '../disconnect';

function archive(): string {
  const root = mkdtempSync(join(tmpdir(), 'dtqd-teams-disconnect-'));
  mkdirSync(join(root, '频道'));
  mkdirSync(join(root, '私聊'));
  writeFileSync(join(root, '频道', 'a.md'), '# [频道] 团队 › a\n\nx');
  writeFileSync(join(root, '私聊', 'b.md'), '# [私聊] Alice\n\nx');
  writeFileSync(join(root, '最近更新.md'), 'x');
  writeFileSync(join(root, '.sync-state.json'), '{}');
  return root;
}

beforeEach(() => {
  h.calls.length = 0;
  h.windows = [];
  h.connected = true;
  h.rows = true;
  h.root = archive();
});

describe('disconnectMicrosoftWeb', () => {
  it('先挡新同步，再关窗口、等同步结束，最后才清登录', async () => {
    h.windows = [
      {
        webContents: { session: teamsStub },
        destroy: () => h.calls.push('teams-window-destroyed'),
      },
      { webContents: { session: {} }, destroy: () => h.calls.push('other-window-destroyed') },
    ];
    await expect(disconnectMicrosoftWeb(false)).resolves.toEqual({
      connected: false,
      hasData: true,
    });
    expect(h.calls).not.toContain('other-window-destroyed');
    const at = (name: string) => h.calls.indexOf(name);
    expect(at('snapshot-removed')).toBeLessThan(at('teams-window-destroyed'));
    expect(at('teams-window-destroyed')).toBeLessThan(at('teams-settled'));
    expect(at('teams-settled')).toBeLessThan(at('login-cleared'));
    expect(at('outlook-settled')).toBeLessThan(at('login-cleared'));
    expect(h.calls).toContain('forget:teams,outlook');
    expect(h.calls).toContain('calendar-clear');
  });

  it('只断开时保留 Teams 存档和邮件列表', async () => {
    await disconnectMicrosoftWeb(false);
    expect(existsSync(join(h.root, '频道', 'a.md'))).toBe(true);
    expect(h.calls).not.toContain('outlook-clear:true');
  });

  it('选择删除时删掉 Teams 存档和邮件列表', async () => {
    await expect(disconnectMicrosoftWeb(true)).resolves.toEqual({
      connected: false,
      hasData: false,
    });
    expect(existsSync(h.root)).toBe(false);
    expect(h.calls).toContain('outlook-clear:true');
  });

  it('连点两次只执行一次', async () => {
    await Promise.all([disconnectMicrosoftWeb(false), disconnectMicrosoftWeb(false)]);
    expect(h.calls.filter((call) => call === 'login-cleared')).toHaveLength(1);
  });
});

describe('deleteTeamsArchive', () => {
  it('学生放进去的其他文件不动', () => {
    writeFileSync(join(h.root, '频道', '我的笔记.pdf'), 'x');
    writeFileSync(join(h.root, '频道', '我的笔记.md'), '# 复习要点');
    writeFileSync(join(h.root, '想法.md'), '随手记');
    deleteTeamsArchive(h.root);
    expect(existsSync(join(h.root, '频道', 'a.md'))).toBe(false);
    expect(existsSync(join(h.root, '私聊'))).toBe(false);
    expect(existsSync(join(h.root, '最近更新.md'))).toBe(false);
    expect(existsSync(join(h.root, '.sync-state.json'))).toBe(false);
    expect(existsSync(join(h.root, '频道', '我的笔记.pdf'))).toBe(true);
    expect(existsSync(join(h.root, '频道', '我的笔记.md'))).toBe(true);
    expect(existsSync(join(h.root, '想法.md'))).toBe(true);
  });

  it('只剩学生自己的 Markdown 时不算有存档', () => {
    writeFileSync(join(h.root, '频道', '我的笔记.md'), '# 复习要点');
    expect(hasTeamsArchive(h.root)).toBe(true);
    deleteTeamsArchive(h.root);
    expect(hasTeamsArchive(h.root)).toBe(false);
  });

  it('目录不存在时不报错', () => {
    expect(() => deleteTeamsArchive(join(h.root, 'none'))).not.toThrow();
  });
});

describe('IPC', () => {
  it('校验发送方和参数', async () => {
    registerMicrosoftWebDisconnectIpc();
    const handler = h.handlers.get('teams:disconnect')!;
    expect(() => handler({}, 'yes')).toThrow('参数无效');
    expect(h.calls).toContain('checked');
    expect(h.calls).not.toContain('login-cleared');
  });
});
