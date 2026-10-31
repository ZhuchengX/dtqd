import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, safeStorage: {}, session: {} }));

const { isTeamsLoginCookie } = await import('../session');

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
