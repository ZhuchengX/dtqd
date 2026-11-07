// 用 Outlook 网页版读学校邮箱：不用注册 Azure，也不要管理员同意。学生在窗口里自己登录，
// 之后用透明窗口打开同一页面，只读收件箱列表每行的描述，不点开邮件（点开会变成已读），不碰令牌。
import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import type { OutlookWebState, OutlookWebStatus } from '../../shared/outlook-web';
import { checkWorkspaceSender } from '../ipc';
import { guardNavigation, teamsSession } from '../teams/window';
import {
  markOutlookWebConnected,
  outlookWebConnected,
  outlookWebState,
  recordOutlookWebSync,
  saveRows,
  type ScrapedRow,
} from './store';

const OUTLOOK_URL = 'https://outlook.cloud.microsoft/mail/';
const POLL_MS = 2000;
const LOAD_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 15 * 60_000;
const SCROLL_SCREENS = 6;
const SCROLL_WAIT_MS = 500;

const COUNT_SCRIPT = `document.querySelectorAll('[role=option][data-convid]').length`;

/** 从上往下滚几屏，收集每行的会话 id 和描述；最后滚回顶部。 */
const READ_SCRIPT = `(async () => {
  const rows = () => [...document.querySelectorAll('[role=option][data-convid]')];
  const found = new Map();
  const collect = () => rows().forEach((row) => {
    const id = row.getAttribute('data-convid');
    const label = row.getAttribute('aria-label');
    if (id && label && !found.has(id)) found.set(id, label);
  });
  let box = rows()[0];
  while (box && !(box.scrollHeight > box.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  collect();
  for (let i = 0; box && i < ${SCROLL_SCREENS}; i += 1) {
    box.scrollTop += box.clientHeight;
    await new Promise((resolve) => setTimeout(resolve, ${SCROLL_WAIT_MS}));
    collect();
  }
  return [...found].map(([id, label]) => ({ id, label }));
})()`;

function onLoginPage(contents: WebContents): boolean {
  return /^https:\/\/login\./.test(contents.getURL());
}

async function rowCount(contents: WebContents): Promise<number> {
  return Number(await contents.executeJavaScript(COUNT_SCRIPT).catch(() => 0));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRows(contents: WebContents, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !contents.isDestroyed()) {
    if ((await rowCount(contents)) > 0) return true;
    await sleep(POLL_MS);
  }
  return false;
}

let visible: BrowserWindow | undefined;

async function openVisible(): Promise<BrowserWindow> {
  if (visible && !visible.isDestroyed()) {
    visible.show();
    visible.focus();
    return visible;
  }
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Outlook · DTQD',
    webPreferences: {
      session: await teamsSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  guardNavigation(window);
  window.on('closed', () => {
    visible = undefined;
  });
  visible = window;
  void window.loadURL(OUTLOOK_URL);
  return window;
}

async function connect(): Promise<boolean> {
  const window = await openVisible();
  const ok = await waitForRows(window.webContents, CONNECT_TIMEOUT_MS).catch(() => false);
  if (!ok) return false;
  markOutlookWebConnected();
  window.destroy();
  void syncOutlookWeb().catch((error: unknown) => console.warn('[outlook] 同步失败', error));
  return true;
}

export interface OutlookWebSync {
  status: OutlookWebStatus;
  added: number;
}

/** 隐藏窗口（show: false）不渲染列表，只能用透明、不抢焦点、鼠标穿透的窗口。 */
async function runSync(): Promise<OutlookWebSync> {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      session: await teamsSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.setAudioMuted(true);
  try {
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    void window.loadURL(OUTLOOK_URL);
    const loaded = await waitForRows(window.webContents, LOAD_TIMEOUT_MS);
    // 同步途中学生断开了账号，窗口已被销毁。
    if (window.isDestroyed()) return { status: 'not-ready', added: 0 };
    if (!loaded)
      return {
        status: onLoginPage(window.webContents) ? 'needs-login' : 'not-ready',
        added: 0,
      };
    const rows = (await window.webContents.executeJavaScript(READ_SCRIPT)) as ScrapedRow[];
    return { status: 'ok', added: saveRows(rows, new Date().toISOString()) };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

let running: Promise<OutlookWebSync> | null = null;

export function syncOutlookWeb(): Promise<OutlookWebSync> {
  if (!outlookWebConnected()) return Promise.resolve({ status: 'needs-login', added: 0 });
  running ??= runSync()
    .then((result) => {
      recordOutlookWebSync(result.status, new Date().toISOString());
      return result;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** 等进行中的同步结束（断开账号前用）。 */
export async function outlookWebSyncSettled(): Promise<void> {
  await running?.catch(() => undefined);
}

export function registerOutlookWebIpc(): void {
  ipcMain.handle('outlook-web:state', (event): OutlookWebState => {
    checkWorkspaceSender(event);
    return outlookWebState();
  });
  ipcMain.handle('outlook-web:connect', (event) => {
    checkWorkspaceSender(event);
    return connect();
  });
  ipcMain.handle('outlook-web:sync', async (event): Promise<OutlookWebState> => {
    checkWorkspaceSender(event);
    await syncOutlookWeb();
    return outlookWebState();
  });
  ipcMain.handle('outlook-web:open', async (event) => {
    checkWorkspaceSender(event);
    await openVisible();
  });
}
