// 仅 macOS：从本机 Chrome / Edge 读取 dundee.ac.uk 的登录 Cookie 导入校园会话，免去在登录窗里再登一次。
// 只取 dundee.ac.uk 域，其余站点的 Cookie 不读不解密。Windows 版 Chrome 127 起用应用绑定加密，无法这样读取。
// 解密：钥匙串「Chrome Safe Storage」口令 → PBKDF2-SHA1(saltysalt, 1003 次, 16 字节) → AES-128-CBC（IV 为 16 个空格），
// 密文前缀 v10；Cookies 库 meta.version ≥ 24 时明文前 32 字节是 SHA256(host_key)，需要去掉。
import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CookiesSetDetails, Session } from 'electron';

interface ChromeBrowser {
  name: string;
  dir: string;
  keychainService: string;
}

const BROWSERS: readonly ChromeBrowser[] = [
  { name: 'Chrome', dir: 'Google/Chrome', keychainService: 'Chrome Safe Storage' },
  { name: 'Edge', dir: 'Microsoft Edge', keychainService: 'Microsoft Edge Safe Storage' },
];

const SAMESITE = ['no_restriction', 'lax', 'strict'] as const;
/** Chrome 时间戳是 1601-01-01 起的微秒数。 */
const WINDOWS_EPOCH_OFFSET = 11644473600;

export interface ChromeCookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Buffer;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  last_access_utc: number;
}

export function isDundeeHost(host: string): boolean {
  const bare = host.replace(/^\./, '').toLowerCase();
  return bare === 'dundee.ac.uk' || bare.endsWith('.dundee.ac.uk');
}

export function deriveChromeKey(password: string): Buffer {
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

export function decryptChromeValue(encrypted: Buffer, key: Buffer, dbVersion: number): string {
  if (encrypted.subarray(0, 3).toString() !== 'v10') throw new Error('不支持的 Cookie 加密格式');
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  return (dbVersion >= 24 ? plain.subarray(32) : plain).toString('utf8');
}

/** 把一行 Chrome Cookie 转成 Electron cookies.set 参数；会话 Cookie（expires_utc=0）不带过期时间。 */
export function toElectronCookie(row: ChromeCookieRow, value: string): CookiesSetDetails {
  const host = row.host_key.replace(/^\./, '');
  const expires = row.expires_utc > 0 ? row.expires_utc / 1e6 - WINDOWS_EPOCH_OFFSET : undefined;
  return {
    url: `https://${host}${row.path || '/'}`,
    name: row.name,
    value,
    // 以点开头的是域 Cookie；否则不传 domain，保持仅限该主机。
    ...(row.host_key.startsWith('.') ? { domain: row.host_key } : {}),
    path: row.path || '/',
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    ...(expires ? { expirationDate: expires } : {}),
    ...(SAMESITE[row.samesite] ? { sameSite: SAMESITE[row.samesite] } : {}),
  };
}

interface DundeeCookieStore {
  browser: ChromeBrowser;
  rows: ChromeCookieRow[];
  dbVersion: number;
  lastAccess: number;
}

async function cookieFiles(browser: ChromeBrowser): Promise<string[]> {
  const root = join(homedir(), 'Library/Application Support', browser.dir);
  let profiles: string[];
  try {
    profiles = (await readdir(root)).filter((name) => /^(Default|Profile \d+)$/.test(name));
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const profile of profiles)
    for (const candidate of [
      join(root, profile, 'Network/Cookies'),
      join(root, profile, 'Cookies'),
    ])
      if (
        await stat(candidate).then(
          () => true,
          () => false,
        )
      ) {
        files.push(candidate);
        break;
      }
  return files;
}

/** 浏览器运行时会锁住 Cookies 库，先复制到临时目录再只读打开。 */
async function readDundeeRows(
  file: string,
): Promise<{ rows: ChromeCookieRow[]; dbVersion: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'dtqd-cookies-'));
  try {
    const copy = join(dir, 'Cookies');
    await copyFile(file, copy);
    const db = new Database(copy, { readonly: true });
    try {
      const meta = db.prepare("SELECT value FROM meta WHERE key='version'").get() as
        { value: string } | undefined;
      const rows = (
        db
          .prepare(
            `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly,
                    samesite, last_access_utc
             FROM cookies WHERE host_key LIKE '%dundee.ac.uk'`,
          )
          .all() as ChromeCookieRow[]
      ).filter((row) => isDundeeHost(row.host_key));
      return { rows, dbVersion: Number(meta?.value ?? 0) };
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 各浏览器、各用户资料里含 my.dundee.ac.uk Cookie 的库，按最近访问排序。 */
async function findDundeeStores(): Promise<DundeeCookieStore[]> {
  const stores: DundeeCookieStore[] = [];
  for (const browser of BROWSERS)
    for (const file of await cookieFiles(browser)) {
      const { rows, dbVersion } = await readDundeeRows(file).catch(() => ({
        rows: [],
        dbVersion: 0,
      }));
      const blackboard = rows.filter((row) => /my\.dundee\.ac\.uk$/i.test(row.host_key));
      if (blackboard.length === 0) continue;
      const lastAccess = Math.max(...blackboard.map((row) => row.last_access_utc));
      stores.push({ browser, rows, dbVersion, lastAccess });
    }
  return stores.sort((a, b) => b.lastAccess - a.lastAccess);
}

/** 读钥匙串口令时 macOS 会弹授权框，由学生本人点「允许」。 */
function keychainPassword(service: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-w', '-s', service], (error, stdout) => {
      if (error) reject(new Error('未获得钥匙串授权，无法读取浏览器登录信息'));
      else resolve(stdout.trim());
    });
  });
}

/**
 * 依次尝试各浏览器资料，导入后用 probe 验证登录；成功即返回浏览器名，全部失败抛出错误。
 * 解密口令只在本次调用内使用，不落盘。
 */
export async function importDundeeCookies(
  session: Session,
  probe: () => Promise<void>,
): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('从浏览器导入登录目前只支持 macOS');
  const stores = await findDundeeStores();
  if (stores.length === 0)
    throw new Error('没在 Chrome / Edge 里找到 myDundee 登录信息，请先在浏览器里登录 myDundee');
  const keys = new Map<string, Buffer>();
  for (const store of stores) {
    let key = keys.get(store.browser.name);
    if (!key) {
      key = deriveChromeKey(await keychainPassword(store.browser.keychainService));
      keys.set(store.browser.name, key);
    }
    for (const row of store.rows) {
      let value = row.value;
      try {
        if (!value && row.encrypted_value?.length)
          value = decryptChromeValue(row.encrypted_value, key, store.dbVersion);
        await session.cookies.set(toElectronCookie(row, value));
      } catch {
        // 单个 Cookie 解不开或写入失败时跳过，最终以 probe 结果为准。
      }
    }
    try {
      await probe();
      return store.browser.name;
    } catch {
      // 该资料的登录已过期，换下一个。
    }
  }
  throw new Error('浏览器里的 myDundee 登录已过期，请先在浏览器里重新登录 myDundee');
}
