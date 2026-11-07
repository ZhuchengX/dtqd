import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userData: '',
  listener: undefined as undefined | ((...args: unknown[]) => void),
  cookies: [] as unknown[],
}));
const teams = vi.hoisted(() => ({
  cookies: {
    get: async () => h.cookies,
    set: async () => undefined,
    on: (_name: string, listener: (...args: unknown[]) => void) => {
      h.listener = listener;
    },
    flushStore: async () => undefined,
  },
  clearStorageData: vi.fn(async () => undefined),
  clearCache: vi.fn(async () => undefined),
  clearAuthCache: vi.fn(async () => undefined),
}));
vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text),
    decryptString: (data: Buffer) => data.toString(),
  },
  session: { fromPartition: () => teams },
}));

const { clearTeamsLogin, getTeamsSession, isTeamsLoginCookie, removeTeamsSnapshot } =
  await import('../session');

describe('isTeamsLoginCookie', () => {
  it('保存微软登录、Teams 与学校 SSO 的 Cookie', () => {
    for (const domain of [
      '.login.microsoftonline.com',
      'login.microsoftonline.com',
      'teams.cloud.microsoft',
      '.idp.dundee.ac.uk',
    ])
      expect(isTeamsLoginCookie({ domain })).toBe(true);
  });

  it('其他站点与仿冒域名不保存', () => {
    for (const domain of ['.example.com', 'login.microsoftonline.com.evil.example', undefined])
      expect(isTeamsLoginCookie({ domain })).toBe(false);
  });
});

describe('clearTeamsLogin', () => {
  const cookie = {
    domain: '.login.microsoftonline.com',
    path: '/',
    name: 'ESTSAUTH',
    value: 'v',
    session: true,
  };

  it('清分区和保存的会话；之后到达的 Cookie 事件不会把旧会话写回', async () => {
    h.userData = mkdtempSync(join(tmpdir(), 'dtqd-teams-session-'));
    const snapshot = join(h.userData, 'teams-session.bin');
    await getTeamsSession(() => undefined);
    h.listener!({}, cookie, 'explicit', false);
    expect(existsSync(snapshot)).toBe(true);

    await clearTeamsLogin(teams as never);
    expect(teams.clearStorageData).toHaveBeenCalled();
    expect(teams.clearCache).toHaveBeenCalled();
    expect(existsSync(snapshot)).toBe(false);

    h.listener!({}, { ...cookie, name: 'OTHER' }, 'explicit', true);
    expect(existsSync(snapshot)).toBe(false);
  });

  it('removeTeamsSnapshot 文件不存在时不报错', () => {
    expect(() => removeTeamsSnapshot()).not.toThrow();
  });
});
