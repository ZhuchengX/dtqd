// Microsoft 365 令牌管理：按资源缓存、refresh token 轮换写回、并发刷新串行、邮件凭据分流。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicrosoftCredential } from '../../credentials';

const settings = vi.hoisted(() => new Map<string, string>());

vi.mock('electron', () => ({ app: {}, safeStorage: {} }));
vi.mock('../../credentials', () => ({
  clearMicrosoftCredential: vi.fn(),
  loadMicrosoftCredential: vi.fn(),
  saveMicrosoftCredential: vi.fn(),
}));
vi.mock('../store', () => ({
  readMailSetting: (key: string) => settings.get(key),
  writeMailSetting: (key: string, value: string) => settings.set(key, value),
}));

import {
  getMicrosoftAccessToken,
  getMicrosoftConfig,
  resetMicrosoftTokenCache,
  resolveMailSecret,
  resolveSmtpAuth,
  setMailAuthProvider,
} from '../microsoft';
import { loadMicrosoftCredential } from '../../credentials';
import type { FetchLike } from '../oauth';

const credential: MicrosoftCredential = {
  address: '2400001@dundee.ac.uk',
  clientId: '11111111-2222-3333-4444-555555555555',
  tenant: 'organizations',
  refreshToken: 'rt-1',
  channels: false,
  savedAt: '2026-10-31T00:00:00.000Z',
};

function tokenFetch(responses: Array<Record<string, unknown>>) {
  const scopes: string[] = [];
  const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
    const body = new URLSearchParams(init.body);
    scopes.push(body.get('scope') ?? '');
    const next = responses.shift() ?? { access_token: 'fallback', expires_in: 3600 };
    return { json: async () => next };
  });
  return { fetchImpl, scopes };
}

beforeEach(() => {
  settings.clear();
  resetMicrosoftTokenCache();
  vi.mocked(loadMicrosoftCredential).mockReset();
});

describe('getMicrosoftAccessToken', () => {
  it('Outlook 与 Graph 分别换令牌，同一 refresh token；有效期内走缓存', async () => {
    let stored = { ...credential };
    const save = vi.fn((next: MicrosoftCredential) => {
      stored = next;
    });
    const { fetchImpl, scopes } = tokenFetch([
      { access_token: 'outlook-at', refresh_token: 'rt-2', expires_in: 3600 },
      { access_token: 'graph-at', expires_in: 3600 },
    ]);
    const deps = { fetchImpl, now: () => 0, load: () => stored, save };
    expect(await getMicrosoftAccessToken('outlook', deps)).toBe('outlook-at');
    expect(await getMicrosoftAccessToken('outlook', deps)).toBe('outlook-at');
    expect(await getMicrosoftAccessToken('graph', deps)).toBe('graph-at');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(scopes[0]).toContain('outlook.office.com/IMAP.AccessAsUser.All');
    expect(scopes[0]).not.toContain('graph.microsoft.com');
    expect(scopes[1]).toContain('graph.microsoft.com/Chat.Read');
    // 轮换后的 refresh token 立即写回，第二次（Graph）刷新用的是新值。
    expect(save).toHaveBeenCalledWith({ ...credential, refreshToken: 'rt-2' });
    const second = new URLSearchParams(vi.mocked(fetchImpl).mock.calls[1]![1].body);
    expect(second.get('refresh_token')).toBe('rt-2');
  });

  it('令牌临近过期即刷新', async () => {
    let now = 0;
    const { fetchImpl } = tokenFetch([
      { access_token: 'a1', expires_in: 600 },
      { access_token: 'a2', expires_in: 600 },
    ]);
    const deps = { fetchImpl, now: () => now, load: () => credential, save: vi.fn() };
    expect(await getMicrosoftAccessToken('outlook', deps)).toBe('a1');
    now = 500_000;
    expect(await getMicrosoftAccessToken('outlook', deps)).toBe('a2');
  });

  it('并发请求串行刷新，只打一次令牌端点', async () => {
    const { fetchImpl } = tokenFetch([{ access_token: 'once', expires_in: 3600 }]);
    const deps = { fetchImpl, now: () => 0, load: () => credential, save: vi.fn() };
    const results = await Promise.all([
      getMicrosoftAccessToken('outlook', deps),
      getMicrosoftAccessToken('outlook', deps),
    ]);
    expect(results).toEqual(['once', 'once']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('未登录、未请求频道权限、refresh token 失效时给出可读错误', async () => {
    await expect(getMicrosoftAccessToken('graph', { load: () => null })).rejects.toThrow(
      /未登录 Microsoft 365/,
    );
    await expect(
      getMicrosoftAccessToken('graph-channels', { load: () => credential }),
    ).rejects.toThrow(/管理员同意/);
    const { fetchImpl } = tokenFetch([
      { error: 'invalid_grant', error_description: 'AADSTS70000: revoked' },
    ]);
    await expect(
      getMicrosoftAccessToken('outlook', { fetchImpl, load: () => credential }),
    ).rejects.toMatchObject({ name: 'MicrosoftAuthError', code: 'invalid_grant' });
    // 失败不会卡住后续刷新链。
    const ok = tokenFetch([{ access_token: 'later', expires_in: 3600 }]);
    expect(
      await getMicrosoftAccessToken('outlook', { fetchImpl: ok.fetchImpl, load: () => credential }),
    ).toBe('later');
  });
});

describe('邮件凭据分流', () => {
  const mail = { address: '2400001@dundee.ac.uk', password: 'pw' };

  it('密码账号原样返回密码（交大/第三方 IMAP 路径不变）', async () => {
    expect(await resolveMailSecret(mail)).toBe('pw');
    expect(await resolveSmtpAuth(mail)).toEqual({ user: mail.address, pass: 'pw' });
  });

  it('Microsoft 账号返回 access token，SMTP 走 OAuth2', async () => {
    setMailAuthProvider('microsoft');
    vi.mocked(loadMicrosoftCredential).mockReturnValue(credential);
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json({ access_token: 'imap-at', expires_in: 3600 }),
    ) as typeof fetch;
    try {
      expect(await resolveMailSecret(mail)).toEqual({ accessToken: 'imap-at' });
      expect(await resolveSmtpAuth(mail)).toEqual({
        type: 'OAuth2',
        user: mail.address,
        accessToken: 'imap-at',
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('getMicrosoftConfig 回填已保存的应用参数，不含令牌', () => {
    settings.set('mail-ms-client-id', credential.clientId);
    settings.set('mail-ms-tenant', 'dundee.ac.uk');
    setMailAuthProvider('microsoft');
    vi.mocked(loadMicrosoftCredential).mockReturnValue(credential);
    const view = getMicrosoftConfig();
    expect(view).toEqual({
      clientId: credential.clientId,
      tenant: 'dundee.ac.uk',
      channels: false,
      signedIn: true,
      address: credential.address,
    });
    expect(JSON.stringify(view)).not.toContain('rt-1');
  });
});
