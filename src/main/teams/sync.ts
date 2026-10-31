// Teams 增量同步：借已登录的 Teams 网页客户端把消息同步到它自己的本地缓存，再从缓存里读出上次以来的新消息，
// 按会话追加到 文档/DTQD/teams/ 下的 Markdown，并覆盖写「最近更新.md」供 agent 汇总。
// 不发任何网络请求、不读令牌；没登录过 Teams 时直接跳过。
import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import { checkWorkspaceSender } from '../ipc';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { availablePath, diskName, storageDirectory } from '../storage';
import { buildThreads, digestMarkdown, threadMarkdown, type TeamsThread } from './digest';
import type { TeamsSyncResult } from '../../shared/teams';
import { extractScript, mentionIndex, STATS_SCRIPT, type RawTeamsSnapshot } from './extract';
import { saveTeamsEvents } from './calendar';
import { TEAMS_URL, teamsSession, visibleTeamsWindow } from './window';

const POLL_MS = 5000;
const MIN_WAIT_MS = 15000;
const MAX_WAIT_MS = 120000;

interface SyncState {
  since: number;
  /** 会话 id → 存档文件名（相对 teams 目录），保证改名后仍追加到同一个文件。 */
  files: Record<string, string>;
}

export function teamsDirectory(): string {
  return join(storageDirectory(), 'teams');
}

async function readState(dir: string): Promise<SyncState> {
  try {
    const parsed = JSON.parse(
      await readFile(join(dir, '.sync-state.json'), 'utf8'),
    ) as Partial<SyncState>;
    return { since: Number(parsed.since) || 0, files: parsed.files ?? {} };
  } catch {
    return { since: 0, files: {} };
  }
}

async function writeState(dir: string, state: SyncState): Promise<void> {
  const path = join(dir, '.sync-state.json');
  await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${path}.tmp`, path);
}

/** 等 Teams 客户端把消息同步进本地缓存：消息链数与最新时间连续两次不变即认为同步完。 */
async function waitUntilSynced(
  contents: WebContents,
): Promise<'ready' | 'needs-login' | 'timeout'> {
  const started = Date.now();
  let previous = '';
  let stable = 0;
  while (Date.now() - started < MAX_WAIT_MS) {
    await delay(POLL_MS);
    if (contents.isDestroyed()) return 'timeout';
    const stats = (await contents.executeJavaScript(STATS_SCRIPT).catch(() => null)) as {
      login?: boolean;
      chains?: number;
      latest?: number;
    } | null;
    if (stats?.login && Date.now() - started > MIN_WAIT_MS) return 'needs-login';
    if (!stats || stats.login || !stats.chains) continue;
    const key = `${stats.chains}:${stats.latest}`;
    stable = key === previous ? stable + 1 : 0;
    previous = key;
    if (stable >= 2 && Date.now() - started >= MIN_WAIT_MS) return 'ready';
  }
  return previous ? 'ready' : 'timeout';
}

async function archiveThread(dir: string, state: SyncState, thread: TeamsThread): Promise<void> {
  let relative = state.files[thread.conversationId];
  if (!relative) {
    const folder = join(dir, thread.kind);
    await mkdir(folder, { recursive: true });
    const path = availablePath(folder, `${diskName(thread.name)}.md`);
    relative = join(thread.kind, path.slice(folder.length + 1));
    state.files[thread.conversationId] = relative;
    await writeFile(path, `# [${thread.kind}] ${thread.name}\n\n`);
  }
  await appendFile(join(dir, relative), `${threadMarkdown(thread)}\n`);
}

async function withTeamsPage<T>(run: (contents: WebContents) => Promise<T>): Promise<T> {
  const visible = visibleTeamsWindow();
  if (visible && visible.webContents.getURL().startsWith(TEAMS_URL.slice(0, -1)))
    return run(visible.webContents);
  const hidden = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: {
      session: await teamsSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // 隐藏窗口不打开任何弹窗，也不离开微软域。
  hidden.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    void hidden.loadURL(TEAMS_URL);
    return await run(hidden.webContents);
  } finally {
    if (!hidden.isDestroyed()) hidden.destroy();
  }
}

/** 同步结果；digest 是本次新消息的汇总正文，交给重要事项提取（不经 IPC 发给页面）。 */
export type TeamsSyncOutcome = TeamsSyncResult & { digest?: string };

let running: Promise<TeamsSyncOutcome> | undefined;

/** 同步一次；已在同步中时返回 busy。 */
export function syncTeams(): Promise<TeamsSyncOutcome> {
  if (running) return Promise.resolve({ status: 'busy', newMessages: 0, conversations: 0 });
  running = withTeamsPage(async (contents) => {
    const ready = await waitUntilSynced(contents);
    if (ready === 'needs-login')
      return { status: 'needs-login', newMessages: 0, conversations: 0 } as const;
    if (ready === 'timeout')
      return { status: 'not-ready', newMessages: 0, conversations: 0 } as const;
    const dir = teamsDirectory();
    await mkdir(dir, { recursive: true });
    const state = await readState(dir);
    const snapshot = (await contents.executeJavaScript(
      extractScript(state.since),
    )) as RawTeamsSnapshot;
    const activities = snapshot.activities ?? [];
    const threads = buildThreads(
      snapshot.conversations,
      snapshot.messages,
      mentionIndex(activities),
    );
    if (snapshot.events) saveTeamsEvents(snapshot.events);
    // 只记动态类型与条数（不含内容），便于确认 @我 的类型名。
    const types = new Map<string, number>();
    for (const activity of activities)
      types.set(activity.type, (types.get(activity.type) ?? 0) + 1);
    console.info('[teams] 动态', Object.fromEntries(types), '日程', snapshot.events?.length ?? 0);
    for (const thread of threads) await archiveThread(dir, state, thread);
    const now = Date.now();
    const digestPath = join(dir, '最近更新.md');
    const digest = digestMarkdown(threads, state.since, now);
    // 没有新消息时保留上一份「最近更新」，学生翻看时还能看到最近一批。
    if (threads.length > 0 || !existsSync(digestPath)) await writeFile(digestPath, digest);
    await writeState(dir, { since: Math.max(state.since, snapshot.latest), files: state.files });
    return {
      status: 'ok',
      newMessages: threads.reduce((sum, thread) => sum + thread.messages.length, 0),
      conversations: threads.length,
      digestPath,
      digest,
    } as const;
  }).finally(() => {
    running = undefined;
  });
  return running;
}

/** 登录过 Teams（有保存的登录会话）才在启动时自动同步。 */
export function hasTeamsLogin(): boolean {
  return existsSync(join(app.getPath('userData'), 'teams-session.bin'));
}

export function registerTeamsSyncIpc(): void {
  ipcMain.handle('teams:sync', async (event) => {
    checkWorkspaceSender(event);
    const { digest: _digest, ...result } = await syncTeams();
    return result;
  });
}
