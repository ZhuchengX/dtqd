// Microsoft Teams 网页版独立窗口：学生在窗内自行登录 Dundee 账号，DTQD 不读取其中的消息或令牌。
// 独立持久分区，与校园会话互不影响；只允许微软登录与 Teams 相关域名在窗内打开，其余链接交给系统浏览器。
import { BrowserWindow, ipcMain, session, shell, type Session } from 'electron';
import { attachContextMenu, checkWorkspaceSender } from '../ipc';

export const TEAMS_PARTITION = 'persist:dtqd-teams';
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

let configured: Session | undefined;
function teamsSession(): Session {
  if (configured) return configured;
  const teams = session.fromPartition(TEAMS_PARTITION);
  teams.setUserAgent(teamsUserAgent(teams.getUserAgent()));
  // 通知、麦克风/摄像头、剪贴板只授予微软域内的页面（Teams 通话与提醒需要）。
  teams.setPermissionRequestHandler((contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isTeamsInternalUrl(contents.getURL()));
  });
  teams.setPermissionCheckHandler(
    (_contents, permission, origin) =>
      ALLOWED_PERMISSIONS.has(permission) && isTeamsInternalUrl(origin),
  );
  configured = teams;
  return teams;
}

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
export function openTeamsWindow(): void {
  if (teamsWindow && !teamsWindow.isDestroyed()) {
    if (teamsWindow.isMinimized()) teamsWindow.restore();
    teamsWindow.show();
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
    webPreferences: {
      session: teamsSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachContextMenu(window.webContents);
  guardNavigation(window);
  window.on('closed', () => {
    teamsWindow = undefined;
  });
  teamsWindow = window;
  void window.loadURL(TEAMS_URL);
}

export function registerTeamsIpc(): void {
  ipcMain.handle('teams:open', (event) => {
    checkWorkspaceSender(event);
    openTeamsWindow();
  });
}
