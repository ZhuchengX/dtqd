// 重要事项总调度：启动后与每 30 分钟同步一次各来源（Teams、Outlook、myDundee 公告、QQ 接收文件），
// 有新内容且学生允许时交给模型提取，状态广播给页面（inbox:state）。
// 没提取成功（没配模型、模型出错、学生关了 AI 提取）的新内容存进待提取队列，下次一并提取，不会丢。
import { BrowserWindow, ipcMain } from 'electron';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  InboxRun,
  InboxSource,
  InboxSourceStatus,
  InboxState,
  InboxUsage,
} from '../../shared/inbox';
import { checkWorkspaceSender } from '../ipc';
import { readSetting, writeSetting } from '../settings/prefs';
import { storageDirectory } from '../storage';
import { isWorkspaceWindow } from '../notifications/system';
import { configuredTriageModel, triageInbox, type InboxInput } from './engine';
import { inboxPrefs, setInboxPrefs } from './prefs';
import {
  currentCourses,
  readCursors,
  readMyDundee,
  readOutlook,
  readQq,
  readTeams,
  saveCursors,
  type SourceRead,
} from './sources';

export const INBOX_INTERVAL_MS = 30 * 60_000;
const STARTUP_DELAY_MS = 20_000;
const MAX_PENDING_CHARS = 120_000;
const SOURCE_ORDER: InboxSource[] = ['teams', 'outlook', 'mydundee', 'qq'];

interface StoredState {
  sources: InboxSourceStatus[];
  lastRun: InboxRun | null;
  usage?: InboxUsage | null;
}

let running: Promise<InboxState> | null = null;
let nextRunAt: string | null = null;

export function inboxDirectory(): string {
  return join(storageDirectory(), '重要事项');
}

function storedState(): StoredState {
  try {
    const parsed = JSON.parse(readSetting('inbox-state') ?? '{}') as Partial<StoredState>;
    return {
      sources: parsed.sources ?? [],
      lastRun: parsed.lastRun ?? null,
      usage: parsed.usage ?? null,
    };
  } catch {
    return { sources: [], lastRun: null, usage: null };
  }
}

export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** 累加当月用量；跨月从零开始。 */
export function addUsage(
  current: InboxUsage | null,
  usage: { input: number; output: number; cost: number },
  now: Date,
): InboxUsage {
  const month = monthOf(now);
  const base =
    current?.month === month ? current : { month, runs: 0, input: 0, output: 0, cost: 0 };
  return {
    month,
    runs: base.runs + 1,
    input: base.input + usage.input,
    output: base.output + usage.output,
    cost: base.cost + usage.cost,
  };
}

export function getInboxState(): InboxState {
  const stored = storedState();
  const sources = SOURCE_ORDER.map(
    (source) =>
      stored.sources.find((item) => item.source === source) ?? {
        source,
        status: 'idle' as const,
        lastSyncAt: null,
        newItems: 0,
        detail: null,
      },
  );
  return {
    prefs: inboxPrefs(),
    sources,
    running: running !== null,
    lastRun: stored.lastRun,
    usage: stored.usage?.month === monthOf(new Date()) ? stored.usage : null,
    model: configuredTriageModel(),
    nextRunAt,
  };
}

function broadcast(): InboxState {
  const state = getInboxState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && isWorkspaceWindow(window.webContents.getURL()))
      window.webContents.send('inbox:state', state);
  }
  return state;
}

async function readPending(dir: string): Promise<InboxInput[]> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, '.pending.json'), 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as InboxInput[]) : [];
  } catch {
    return [];
  }
}

async function writePending(dir: string, inputs: readonly InboxInput[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, '.pending.json');
  await writeFile(`${path}.tmp`, JSON.stringify(inputs));
  await rename(`${path}.tmp`, path);
}

/** 同一来源的待提取内容合并成一段；超长时丢最早的部分，留最新的。 */
export function mergePending(
  pending: readonly InboxInput[],
  fresh: readonly InboxInput[],
): InboxInput[] {
  return SOURCE_ORDER.flatMap((source) => {
    const text = [...pending, ...fresh]
      .filter((input) => input.source === source && input.text.trim())
      .map((input) => input.text)
      .join('\n\n');
    if (!text) return [];
    return [
      { source, text: text.length > MAX_PENDING_CHARS ? text.slice(-MAX_PENDING_CHARS) : text },
    ];
  });
}

async function readSource(
  source: InboxSource,
  cursor: string | undefined,
  now: number,
): Promise<SourceRead> {
  try {
    if (source === 'teams') return await readTeams();
    if (source === 'outlook') return readOutlook(cursor, now);
    if (source === 'mydundee') return readMyDundee(cursor, now);
    return await readQq(cursor, now);
  } catch (error) {
    return {
      source,
      status: 'error',
      newItems: 0,
      text: '',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runOnce(): Promise<InboxState> {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const cursors = readCursors();
  const previous = storedState();
  const reads: SourceRead[] = [];
  for (const source of SOURCE_ORDER) {
    const read = await readSource(source, cursors[source], now);
    reads.push(read);
    if (read.cursor !== undefined) cursors[source] = read.cursor;
    // 每读完一个来源就更新一次状态，页面上能看到进度。
    const sources = [
      ...previous.sources.filter((item) => item.source !== source),
      {
        source,
        status: read.status,
        lastSyncAt:
          read.status === 'ok'
            ? at
            : (previous.sources.find((item) => item.source === source)?.lastSyncAt ?? null),
        newItems: read.newItems,
        detail: read.detail,
      },
    ];
    previous.sources = sources;
    writeSetting('inbox-state', JSON.stringify(previous));
    broadcast();
  }
  saveCursors(cursors);

  const dir = inboxDirectory();
  const inputs = mergePending(
    await readPending(dir),
    reads.map((read) => ({ source: read.source, text: read.text })),
  );
  const prefs = inboxPrefs();
  let lastRun: InboxRun;
  if (inputs.length === 0) {
    lastRun = { at, status: 'nothing-new', items: 0, todos: 0, model: configuredTriageModel() };
  } else if (!prefs.aiExtract) {
    await writePending(dir, inputs);
    lastRun = { at, status: 'off', items: 0, todos: 0, model: null };
  } else {
    try {
      const result = await triageInbox(dir, inputs, {
        courses: await currentCourses(),
        interests: prefs.interests,
      });
      await writePending(dir, result.status === 'ok' ? [] : inputs);
      lastRun = {
        at,
        status: result.status,
        items: result.items.length,
        todos: result.todos,
        model: result.model,
        ...(result.usage && { tokens: result.usage.input + result.usage.output }),
      };
      if (result.usage) previous.usage = addUsage(previous.usage ?? null, result.usage, new Date());
    } catch (error) {
      console.warn('[inbox] 提取失败', error instanceof Error ? error.message : error);
      await writePending(dir, inputs);
      lastRun = { at, status: 'failed', items: 0, todos: 0, model: configuredTriageModel() };
    }
  }
  writeSetting('inbox-state', JSON.stringify({ ...previous, lastRun }));
  console.info(
    '[inbox] 同步',
    reads.map((r) => `${r.source}:${r.status}/${r.newItems}`).join(' '),
    lastRun.status,
    `${lastRun.items}/${lastRun.todos}`,
  );
  return getInboxState();
}

/** 同步一次全部来源并提取；已在同步中时等同一次。 */
export function runInbox(): Promise<InboxState> {
  if (running) return running;
  running = runOnce().finally(() => {
    running = null;
    broadcast();
  });
  broadcast();
  return running;
}

/** 启动 20 秒后跑第一次，之后每 30 分钟一次。 */
export function scheduleInbox(): void {
  const tick = () => {
    nextRunAt = new Date(Date.now() + INBOX_INTERVAL_MS).toISOString();
    void runInbox().catch((error: unknown) => console.warn('[inbox] 同步失败', error));
  };
  nextRunAt = new Date(Date.now() + STARTUP_DELAY_MS).toISOString();
  setTimeout(() => {
    tick();
    setInterval(tick, INBOX_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export function registerInboxIpc(): void {
  ipcMain.handle('inbox:get-state', (event) => {
    checkWorkspaceSender(event);
    return getInboxState();
  });
  ipcMain.handle('inbox:run', (event) => {
    checkWorkspaceSender(event);
    return runInbox();
  });
  ipcMain.handle('inbox:set-prefs', (event, patch: unknown) => {
    checkWorkspaceSender(event);
    setInboxPrefs(patch);
    return broadcast();
  });
}
