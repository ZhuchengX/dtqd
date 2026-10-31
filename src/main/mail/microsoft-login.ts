// Microsoft 365 登录窗：与校园登录窗（campus.ts）同款的普通子窗口，但用独立分区，
// 不与交大校园会话混用 Cookie。重定向到回环地址 http://localhost 时在网络层拦截取走授权码，
// 不需要真的在本机起 HTTP 服务；MFA、选择账号等全部在微软页面内完成。
import { BrowserWindow, session, type WebContents } from 'electron';
import { MICROSOFT_REDIRECT_URI } from './oauth';

const MICROSOFT_PARTITION = 'persist:microsoft-login';

function createLoginWindow(sender: WebContents): BrowserWindow {
  const parent = BrowserWindow.fromWebContents(sender) ?? undefined;
  const window = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    parent,
    modal: process.platform !== 'darwin' && parent !== undefined,
    autoHideMenuBar: true,
    title: '登录 Dundee Outlook（Microsoft 365）',
    webPreferences: {
      partition: MICROSOFT_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.platform === 'darwin') {
    window.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        !input.isComposing &&
        !input.control &&
        !input.alt &&
        !input.shift &&
        (input.key === 'Escape' || (input.meta && input.key.toLowerCase() === 'w'))
      ) {
        event.preventDefault();
        window.close();
      }
    });
  }
  return window;
}

function isRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    const expected = new URL(MICROSOFT_REDIRECT_URI);
    return parsed.protocol === expected.protocol && parsed.hostname === expected.hostname;
  } catch {
    return false;
  }
}

let pending: Promise<string> | null = null;

/** 打开微软登录页，返回命中回环重定向的完整 URL（含 code/state 或 error）；用户关窗即拒绝。 */
export function openMicrosoftLoginWindow(
  sender: WebContents,
  authorizeUrl: string,
): Promise<string> {
  if (pending) return Promise.reject(new Error('已有一个 Microsoft 登录窗口在进行中'));
  const window = createLoginWindow(sender);
  const loginSession = session.fromPartition(MICROSOFT_PARTITION);
  const result = new Promise<string>((resolve, reject) => {
    let done = false;
    const finish = (outcome: { url: string } | { error: Error }) => {
      if (done) return;
      done = true;
      loginSession.webRequest.onBeforeRequest(null);
      if ('url' in outcome) resolve(outcome.url);
      else reject(outcome.error);
      if (!window.isDestroyed()) window.close();
    };
    loginSession.webRequest.onBeforeRequest(
      { urls: ['http://localhost/*'] },
      (details, callback) => {
        callback({ cancel: true });
        if (isRedirect(details.url)) finish({ url: details.url });
      },
    );
    // 网络层拦截之外再兜底一层导航事件（部分重定向由页面脚本发起）。
    const onNavigate = (event: Electron.Event, url: string) => {
      if (!isRedirect(url)) return;
      event.preventDefault();
      finish({ url });
    };
    window.webContents.on('will-redirect', onNavigate);
    window.webContents.on('will-navigate', onNavigate);
    window.on('closed', () => finish({ error: new Error('未完成 Microsoft 登录') }));
    window.loadURL(authorizeUrl).catch((error: unknown) => {
      // 被拦截的回环导航也会让 loadURL 以 ERR_BLOCKED/ABORTED 结束，此时结果已产生。
      if (!done) finish({ error: error instanceof Error ? error : new Error(String(error)) });
    });
  });
  pending = result;
  const clear = () => {
    pending = null;
  };
  result.then(clear, clear);
  return result;
}
