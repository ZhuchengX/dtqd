// 重要事项总调度：学生接受当前条款后，启动时与每 30 分钟同步一次开启的来源，
// 学生点「开启」AI 提取后才把新内容交给模型，状态广播给页面（inbox:state）。
// 提取失败（没配模型、模型出错）的内容进待提取队列重试；AI 提取关闭时不积压，已有积压立即清空。
import { BrowserWindow, ipcMain } from 'electron';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  InboxPrefs,
  InboxRun,
  InboxSource,
  InboxSourceStatus,
  InboxState,
  InboxUsage,
} from '../../shared/inbox';
import { termsAccepted } from '../consent';
import { checkWorkspaceSender } from '../ipc';
import { readSetting, writeSetting } from '../settings/prefs';
import { storageDirectory } from '../storage';
import { getCampusSession, openCampusLoginWindow } from '../campus';
import { isWorkspaceWindow } from '../notifications/system';
import { CAMPUS_OFFICE_URL } from './campus-web';
import { configuredTriageModel, triageInbox, type InboxInput } from './engine';
import { inboxPrefs, setInboxPrefs } from './prefs';
import {
  currentCourses,
  readCampusWeb,
  readCursors,
  readMyDundee,
  readOutlook,
  readOutlookWeb,
  readQq,
  readTeams,
  saveCursors,
  type SourceRead,
} from './sources';
import { refreshNoticeArchive } from './notice-archive';
import { outlookWebConnected } from '../outlook-web/store';

export const INBOX_INTERVAL_MS = 30 * 60_000;
const STARTUP_DELAY_MS = 20_000;
const MAX_PENDING_CHARS = 120_000;
const SOURCE_ORDER: InboxSource[] = ['teams', 'outlook', 'mydundee', 'campus', 'qq'];

interface StoredState {
  sources: InboxSourceStatus[];
  lastRun: InboxRun | null;
  usage?: InboxUsage | null;
}

let running: Promise<InboxState> | null = null;
let nextRunAt: string | null = null;
/** 本轮开始后断开了账号的来源；下一轮开始时清空。 */
const forgotten = new Set<InboxSource>();

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

let pendingQueue: Promise<unknown> = Promise.resolve();

/** 队列的读改写一个接一个，免得旧快照盖掉刚写入的内容。 */
function updatePending(change: (pending: InboxInput[]) => InboxInput[]): Promise<InboxInput[]> {
  const dir = inboxDirectory();
  const done = pendingQueue.then(async () => {
    const next = change(await readPending(dir));
    await writePending(dir, next);
    return next;
  });
  pendingQueue = done.catch(() => undefined);
  return done;
}

/** 同一来源的待提取内容合并成一段；超长时丢最早的部分，留最新的。 */
export function mergePending(
  pending: readonly InboxInput[],
  fresh: readonly InboxInput[],
): InboxInput[] {
  // 私聊单独成段，关掉私聊开关时能只丢这一段。
  return SOURCE_ORDER.flatMap((source) =>
    [false, true].flatMap((isPrivate) => {
      const text = [...pending, ...fresh]
        .filter(
          (input) =>
            input.source === source && Boolean(input.private) === isPrivate && input.text.trim(),
        )
        .map((input) => input.text)
        .join('\n\n');
      if (!text) return [];
      if (text.length > MAX_PENDING_CHARS)
        console.warn('[inbox] 积压超过上限，丢弃最早的内容', source, text.length);
      return [
        {
          source,
          text: text.length > MAX_PENDING_CHARS ? text.slice(-MAX_PENDING_CHARS) : text,
          ...(isPrivate && { private: true }),
        },
      ];
    }),
  );
}

/** 按此刻的开关留下还允许处理的内容；发送前和写回队列前都要重新过一遍。 */
function allowedInputs(inputs: readonly InboxInput[], prefs: InboxPrefs): InboxInput[] {
  if (!prefs.aiExtract) return [];
  return inputs.filter(
    (input) =>
      prefs.sources[input.source] &&
      !forgotten.has(input.source) &&
      (!input.private || prefs.teamsPrivate),
  );
}

function readInputs(read: SourceRead): InboxInput[] {
  return [
    { source: read.source, text: read.text },
    ...(read.privateText ? [{ source: read.source, text: read.privateText, private: true }] : []),
  ];
}

/** 账号断开后调用：清掉队列和游标，正在进行的那一轮也不再发送或写回这些来源。 */
export async function forgetInboxSources(sources: readonly InboxSource[]): Promise<void> {
  for (const source of sources) forgotten.add(source);
  await updatePending((pending) => pending.filter((input) => !sources.includes(input.source)));
  saveCursors(
    Object.fromEntries(
      Object.entries(readCursors()).filter(([source]) => !forgotten.has(source as InboxSource)),
    ),
  );
}

/** 关掉的内容立即从待提取队列移除；来源的游标同时清掉，重新开启时最多回看约 14 天。 */
async function applyPrefsToPending(prefs: InboxPrefs): Promise<void> {
  await updatePending((pending) => allowedInputs(pending, prefs));
  const cursors = readCursors();
  saveCursors(
    Object.fromEntries(
      Object.entries(cursors).filter(([source]) => prefs.sources[source as InboxSource]),
    ),
  );
}

async function readSource(
  source: InboxSource,
  cursor: string | undefined,
  now: number,
  prefs: InboxPrefs,
): Promise<SourceRead> {
  if (!prefs.sources[source])
    return { source, status: 'idle', newItems: 0, text: '', detail: '已关闭，不读取也不发送' };
  try {
    if (source === 'teams') return await readTeams(cursor, prefs.aiExtract, now);
    if (source === 'outlook')
      return outlookWebConnected() ? await readOutlookWeb(cursor) : readOutlook(cursor, now);
    if (source === 'mydundee') return readMyDundee(cursor, now);
    if (source === 'campus') return await readCampusWeb(cursor, now, prefs.officeNetwork);
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
  forgotten.clear();
  const now = Date.now();
  const at = new Date(now).toISOString();
  const cursors = readCursors();
  const previous = storedState();
  const reads: SourceRead[] = [];
  const startPrefs = inboxPrefs();
  for (const source of SOURCE_ORDER) {
    const read = await readSource(source, cursors[source], now, startPrefs);
    reads.push(read);
    // AI 提取关闭时只推进已有游标：从未提取过的来源首次开启时仍可回看最近几天。
    if (read.cursor !== undefined && (startPrefs.aiExtract || cursors[source] !== undefined))
      cursors[source] = read.cursor;
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

  const dir = inboxDirectory();
  // 读取期间学生可能刚改了开关：选内容和存游标都以最新开关为准。
  // 先落盘再推进游标、再发给模型：中途退出时内容还在队列里，不会丢。
  const fresh = reads.flatMap(readInputs);
  const inputs = await updatePending((pending) =>
    allowedInputs(mergePending(pending, fresh), inboxPrefs()),
  );
  const cursorPrefs = inboxPrefs();
  saveCursors(
    Object.fromEntries(
      Object.entries(cursors).filter(
        ([source]) =>
          cursorPrefs.sources[source as InboxSource] && !forgotten.has(source as InboxSource),
      ),
    ),
  );
  const courses = inputs.length > 0 ? await currentCourses() : [];
  const prefs = inboxPrefs();
  const sendable = allowedInputs(inputs, prefs);
  let lastRun: InboxRun;
  if (!prefs.aiExtract) {
    await updatePending(() => []);
    lastRun = { at, status: 'off', items: 0, todos: 0, model: null };
  } else if (sendable.length === 0) {
    await updatePending(() => []);
    lastRun = { at, status: 'nothing-new', items: 0, todos: 0, model: configuredTriageModel() };
  } else {
    try {
      const result = await triageInbox(
        dir,
        sendable,
        { courses, interests: prefs.interests },
        () => allowedInputs(sendable, inboxPrefs()).length === sendable.length,
      );
      // 提取期间开关可能又变了，写回前再过滤一次。
      const remaining = result.status === 'ok' ? result.rest : sendable;
      await updatePending(() => allowedInputs(remaining, inboxPrefs()));
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
      await updatePending(() => allowedInputs(sendable, inboxPrefs()));
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

/** 同步一次开启的来源并提取；已在同步中时等同一次；未接受当前条款时什么也不做。 */
export function runInbox(): Promise<InboxState> {
  if (running) return running;
  if (!termsAccepted()) return Promise.resolve(getInboxState());
  running = runOnce().finally(() => {
    running = null;
    broadcast();
  });
  broadcast();
  return running;
}

/** 启动 20 秒后第一次检查，之后每 30 分钟一次；未接受条款或关了后台同步时跳过。 */
export function scheduleInbox(): void {
  const tick = () => {
    nextRunAt = new Date(Date.now() + INBOX_INTERVAL_MS).toISOString();
    const prefs = inboxPrefs();
    if (!termsAccepted() || !prefs.backgroundSync) return;
    void runInbox().catch((error: unknown) => console.warn('[inbox] 同步失败', error));
    if (prefs.sources.campus)
      void refreshNoticeArchive(Date.now(), undefined, prefs.officeNetwork).catch(
        (error: unknown) => console.warn('[notices] 刷新失败', error),
      );
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
  ipcMain.handle('inbox:login-campus-office', (event) => {
    checkWorkspaceSender(event);
    return openCampusLoginWindow({
      sender: event.sender,
      title: '登录中南大学校内办公网',
      url: CAMPUS_OFFICE_URL,
      reached: (url) => url.startsWith('https://oa.csu.edu.cn/con/') && !url.includes('logincas'),
      probe: async () => {
        const campus = await getCampusSession();
        const html = await (await campus.fetch(CAMPUS_OFFICE_URL)).text();
        if (html.includes('统一身份认证')) throw new Error('校内办公网仍未登录');
      },
    });
  });
  ipcMain.handle('inbox:run', (event) => {
    checkWorkspaceSender(event);
    return runInbox();
  });
  ipcMain.handle('inbox:set-prefs', async (event, patch: unknown) => {
    checkWorkspaceSender(event);
    await applyPrefsToPending(setInboxPrefs(patch));
    return broadcast();
  });
}
