import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {},
  ipcMain: {},
  BrowserWindow: {},
  session: {},
  safeStorage: {},
  net: {},
  shell: {},
}));
vi.mock('../../campus', () => ({ getCampusSession: vi.fn() }));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));

const { isBlackboardLoginDomain } = await import('../blackboard');

describe('isBlackboardLoginDomain', () => {
  it('邓迪 SSO 和微软登录要清', () => {
    for (const domain of [
      'dundee.ac.uk',
      'my.dundee.ac.uk',
      'login.microsoftonline.com',
      'login.microsoft.com',
      'login.live.com',
    ])
      expect(isBlackboardLoginDomain(domain)).toBe(true);
  });

  it('中南教务和仿冒域名不动', () => {
    for (const domain of [
      'csu.edu.cn',
      'csujwc.its.csu.edu.cn',
      'notdundee.ac.uk',
      'login.microsoftonline.com.evil.example',
    ])
      expect(isBlackboardLoginDomain(domain)).toBe(false);
  });
});
