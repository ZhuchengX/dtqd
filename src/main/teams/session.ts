// Teams 窗口的登录会话：Chromium 只把持久 Cookie 写盘，微软登录的 ESTSAUTH 等是 session Cookie，
// 重启后丢失会要求重新输入密码。仿照校园会话（../campus.ts），把微软域的 session Cookie 加密另存，
// 下次启动写回，效果同 Chrome「继续浏览上次打开的网页」；不人为延长服务端有效期。
import { app, safeStorage, session, type Cookie, type Session } from 'electron';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEAMS_PARTITION = 'persist:dtqd-teams';

const LOGIN_ROOTS = [
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.live.com',
  'teams.cloud.microsoft',
  'teams.microsoft.com',
  'outlook.cloud.microsoft',
  'outlook.office.com',
  'dundee.ac.uk',
];

export function isTeamsLoginCookie(cookie: Pick<Cookie, 'domain'>): boolean {
  const domain = cookie.domain?.replace(/^\./, '').toLowerCase() ?? '';
  return LOGIN_ROOTS.some((root) => domain === root || domain.endsWith(`.${root}`));
}

function snapshotPath(): string {
  return join(app.getPath('userData'), 'teams-session.bin');
}

function cookieKey(cookie: Cookie): string {
  return JSON.stringify([cookie.domain, cookie.path, cookie.name]);
}

function saveSnapshot(path: string, cookies: Iterable<Cookie>): void {
  const saved = [...cookies].filter((cookie) => cookie.session && isTeamsLoginCookie(cookie));
  if (saved.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  // 系统钥匙串不可用时不写明文，只是退回到「重启后重新登录」。
  if (!safeStorage.isEncryptionAvailable()) return;
  writeFileSync(`${path}.tmp`, safeStorage.encryptString(JSON.stringify(saved)));
  renameSync(`${path}.tmp`, path);
}

async function restoreSnapshot(teams: Session, path: string, cookies: Map<string, Cookie>) {
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return;
  let saved: Cookie[];
  try {
    saved = JSON.parse(safeStorage.decryptString(readFileSync(path))) as Cookie[];
  } catch {
    rmSync(path, { force: true });
    return;
  }
  for (const cookie of saved) {
    if (!isTeamsLoginCookie(cookie) || !cookie.session || cookies.has(cookieKey(cookie))) continue;
    await teams.cookies
      .set({
        url: `https://${cookie.domain!.replace(/^\./, '')}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.hostOnly ? undefined : cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
      })
      .then(() => cookies.set(cookieKey(cookie), cookie))
      .catch(() => undefined);
  }
}

let ready: Promise<Session> | undefined;
let trackedCookies: Map<string, Cookie> | undefined;

/** Teams 分区；首次调用时写回上次的 session Cookie，并开始跟踪变化。 */
export function getTeamsSession(configure: (teams: Session) => void): Promise<Session> {
  ready ??= (async () => {
    const teams = session.fromPartition(TEAMS_PARTITION);
    configure(teams);
    const path = snapshotPath();
    const cookies = new Map<string, Cookie>();
    trackedCookies = cookies;
    for (const cookie of await teams.cookies.get({})) cookies.set(cookieKey(cookie), cookie);
    await restoreSnapshot(teams, path, cookies);
    teams.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (!isTeamsLoginCookie(cookie)) return;
      if (removed) cookies.delete(cookieKey(cookie));
      else cookies.set(cookieKey(cookie), cookie);
      try {
        saveSnapshot(path, cookies.values());
      } catch (error) {
        console.error('Teams 登录会话保存失败', error);
      }
    });
    return teams;
  })();
  return ready;
}

/** 立即把 Cookie 与本地存储写盘（关窗、退出时调用），避免刚登录就退出时丢失。 */
export async function flushTeamsSession(): Promise<void> {
  if (!ready) return;
  const teams = await ready;
  await teams.cookies.flushStore();
  teams.flushStorageData();
}

/** 删除保存的登录会话：hasTeamsLogin 随即为假，后台不再启动新的同步。 */
export function removeTeamsSnapshot(): void {
  rmSync(snapshotPath(), { force: true });
}

/** 退出登录：清掉分区里的 Cookie、本地存储和缓存（含 Teams 本地消息缓存），再删保存的会话。 */
export async function clearTeamsLogin(teams: Session): Promise<void> {
  await teams.clearStorageData();
  await Promise.all([teams.clearCache(), teams.clearAuthCache()]);
  // 清空跟踪表：之后到达的 Cookie 变化事件不会把旧会话写回磁盘。
  trackedCookies?.clear();
  removeTeamsSnapshot();
  await teams.cookies.flushStore();
}
