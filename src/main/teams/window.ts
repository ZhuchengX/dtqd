// Microsoft Teams 网页版独立窗口：学生在窗内自行登录 Dundee 账号，DTQD 不读取其中的消息或令牌。
// 独立持久分区，与校园会话互不影响；只允许微软登录与 Teams 相关域名在窗内打开，其余链接交给系统浏览器。
import { BrowserWindow, ipcMain, shell, type Session } from 'electron';
import { windowBackground } from '../window-background';
import { attachContextMenu, checkWorkspaceSender } from '../ipc';
import { flushTeamsSession, getTeamsSession, TEAMS_PARTITION } from './session';

export const TEAMS_URL = 'https://teams.cloud.microsoft/';

const MICROSOFT_ROOTS = [
  'cloud.microsoft',
  'microsoft.com',
  'microsoftonline.com',
  'live.com',
  'office.com',
  'office.net',
  'office365.com',
  'sharepoint.com',
  'skype.com',
  'microsoftstream.com',
  'msauth.net',
  'msftauth.net',
  'msecnd.net',
  'dundee.ac.uk',
];

/** 微软登录、Teams 与学校 SSO 的页面留在窗内，其余地址交给系统浏览器。 */
export function isTeamsInternalUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.protocol === 'about:') return true;
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return MICROSOFT_ROOTS.some((root) => host === root || host.endsWith(`.${root}`));
}

/** Teams 拒绝含「Electron」的 UA（提示浏览器不受支持），去掉 Electron 与应用名，保留 Chrome 版本。 */
export function teamsUserAgent(original: string): string {
  return original
    .replace(/\s*Electron\/\S+/g, '')
    .replace(/\s*(?:dtqd|dela|DTQD|Dela)\/\S+/g, '')
    .trim();
}

const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'display-capture',
]);

function configureTeamsSession(teams: Session): void {
  teams.setUserAgent(teamsUserAgent(teams.getUserAgent()));
  // 通知、麦克风/摄像头、剪贴板只授予微软域内的页面（Teams 通话与提醒需要）。
  teams.setPermissionRequestHandler((contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isTeamsInternalUrl(contents.getURL()));
  });
  teams.setPermissionCheckHandler(
    (_contents, permission, origin) =>
      ALLOWED_PERMISSIONS.has(permission) && isTeamsInternalUrl(origin),
  );
}

/** 已配置好的 Teams 分区（同步用的隐藏窗口与可见窗口共用）。 */
export function teamsSession(): Promise<Session> {
  return getTeamsSession(configureTeamsSession);
}

/** 正在显示的 Teams 窗口（若有），同步时优先复用它。 */
export function visibleTeamsWindow(): BrowserWindow | undefined {
  return teamsWindow && !teamsWindow.isDestroyed() ? teamsWindow : undefined;
}

const REVEAL_STEPS = 10;
const REVEAL_STEP_MS = 20;
const REVEAL_SETTLE_MS = 1200;
const REVEAL_TIMEOUT_MS = 8000;

let teamsWindow: BrowserWindow | undefined;

function guardNavigation(window: BrowserWindow): void {
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    // 登录、会议等弹窗在同一分区打开；外部链接交给系统浏览器。
    if (isTeamsInternalUrl(url))
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { webPreferences: { partition: TEAMS_PARTITION } },
      };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isTeamsInternalUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  contents.on('did-create-window', (child) => {
    attachContextMenu(child.webContents);
    child.webContents.on('will-navigate', (event, url) => {
      if (isTeamsInternalUrl(url)) return;
      event.preventDefault();
      void shell.openExternal(url);
    });
  });
}

/** 打开 Teams 窗口；已打开则前置。 */
export async function openTeamsWindow(): Promise<void> {
  if (teamsWindow && !teamsWindow.isDestroyed()) {
    if (teamsWindow.isMinimized()) teamsWindow.restore();
    teamsWindow.show();
    teamsWindow.focus();
    return;
  }
  const teams = await getTeamsSession(configureTeamsSession);
  // 等会话准备期间又点了一次：窗口已由前一次打开，前置即可。
  if (teamsWindow && !teamsWindow.isDestroyed()) {
    teamsWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    autoHideMenuBar: true,
    title: 'Teams · DTQD',
    show: false,
    backgroundColor: windowBackground(),
    webPreferences: {
      session: teams,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachContextMenu(window.webContents);
  guardNavigation(window);
  window.on('close', () => void flushTeamsSession());
  window.on('closed', () => {
    teamsWindow = undefined;
  });
  teamsWindow = window;
  revealWhenLoaded(window);
  void window.loadURL(TEAMS_URL);
}

/** Teams 先加载再露面，再淡入：不让学生看到白屏和加载中的闪烁。网页迟迟不好也按时露面。 */
function revealWhenLoaded(window: BrowserWindow): void {
  let revealed = false;
  const reveal = () => {
    if (revealed || window.isDestroyed()) return;
    revealed = true;
    window.setOpacity(0);
    window.show();
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      if (window.isDestroyed()) clearInterval(timer);
      else {
        window.setOpacity(Math.min(step / REVEAL_STEPS, 1));
        if (step >= REVEAL_STEPS) clearInterval(timer);
      }
    }, REVEAL_STEP_MS);
  };
  window.webContents.once('did-stop-loading', () => setTimeout(reveal, REVEAL_SETTLE_MS));
  setTimeout(reveal, REVEAL_TIMEOUT_MS);
}

export function registerTeamsIpc(): void {
  ipcMain.handle('teams:open', async (event) => {
    checkWorkspaceSender(event);
    await openTeamsWindow();
  });
}
