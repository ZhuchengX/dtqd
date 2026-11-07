// Teams 同步：存档只追加新消息；给重要事项的汇总可以从更早的提取进度往后取。
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  root: '',
  scripts: [] as string[],
  snapshot: {} as unknown,
  elapsed: 0,
}));

vi.mock('electron', () => ({
  app: { getPath: () => h.root },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() },
}));
// 等同步的轮询靠时间推进：sleep 只拨时钟，不真等。
vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    h.elapsed += ms;
  },
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../storage', () => ({
  storageDirectory: () => h.root,
  diskName: (name: string) => name,
  availablePath: (folder: string, name: string) => `${folder}/${name}`,
}));
vi.mock('../calendar', () => ({ saveTeamsEvents: vi.fn() }));
vi.mock('../window', () => ({
  TEAMS_URL: 'https://teams/',
  teamsSession: vi.fn(),
  visibleTeamsWindow: () => ({
    webContents: {
      getURL: () => 'https://teams/',
      isDestroyed: () => false,
      executeJavaScript: async (script: string) => {
        h.scripts.push(script);
        return script.includes('const since =') ? h.snapshot : { chains: 1, latest: 1 };
      },
    },
  }),
}));

import { syncTeams, teamsDirectory } from '../sync';

const NOW = Date.now();
const OLD = NOW - 3_600_000;
const NEW = NOW - 60_000;
const conversation = {
  id: '19:c@thread.tacv2',
  threadType: 'topic',
  topic: 'MA22004',
  teamId: '19:t@thread.tacv2',
  lastMessageTime: 0,
};
const message = (id: string, time: number) => ({
  conversationId: conversation.id,
  replyChainId: id,
  id,
  time,
  author: 'Dr Smith',
  messageType: 'RichText/Html',
  content: `<p>消息${id}</p>`,
});

async function firstSync(): Promise<void> {
  h.snapshot = { conversations: [conversation], messages: [message('旧', OLD)], latest: OLD };
  await syncTeams();
}

beforeEach(() => {
  h.root = mkdtempSync(join(tmpdir(), 'dtqd-teams-sync-'));
  h.scripts = [];
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + h.elapsed);
});

afterEach(() => vi.restoreAllMocks());

describe('syncTeams', () => {
  it('提取进度落后时：汇总重读旧消息，存档不重复追加', async () => {
    await firstSync();
    h.scripts = [];
    h.snapshot = {
      conversations: [conversation],
      messages: [message('旧', OLD), message('新', NEW)],
      latest: NEW,
    };
    const result = await syncTeams(OLD - 1);
    expect(h.scripts.at(-1)).toContain(`const since = ${OLD - 1};`);
    expect(result.status).toBe('ok');
    expect(result.newMessages).toBe(1);
    expect(result.latest).toBe(NEW);
    expect(result.groupDigest).toContain('消息旧');
    expect(result.groupDigest).toContain('消息新');
    const archive = readFileSync(join(teamsDirectory(), '频道', '未命名团队 › MA22004.md'), 'utf8');
    expect(archive.match(/消息旧/g)).toHaveLength(1);
    expect(archive.match(/消息新/g)).toHaveLength(1);
  });

  it('不传提取进度时只读存档进度之后的', async () => {
    await firstSync();
    h.scripts = [];
    h.snapshot = { conversations: [conversation], messages: [message('新', NEW)], latest: NEW };
    const result = await syncTeams();
    expect(h.scripts.at(-1)).toContain(`const since = ${OLD};`);
    expect(result.groupDigest).toContain('消息新');
    expect(result.groupDigest).not.toContain('消息旧');
  });
});
