import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../../ipc', () => ({ attachContextMenu: vi.fn(), checkWorkspaceSender: vi.fn() }));

const { isTeamsInternalUrl, teamsUserAgent } = await import('../window');

describe('isTeamsInternalUrl', () => {
  it('Teams、微软登录与学校 SSO 留在窗内', () => {
    for (const url of [
      'https://teams.cloud.microsoft/v2/',
      'https://login.microsoftonline.com/common/oauth2/authorize',
      'https://dundee-my.sharepoint.com/personal/x',
      'https://idp.dundee.ac.uk/login',
      'about:blank',
    ])
      expect(isTeamsInternalUrl(url)).toBe(true);
  });

  it('其他站点、明文 http 与仿冒域名交给系统浏览器', () => {
    for (const url of [
      'https://example.com/',
      'http://teams.cloud.microsoft/',
      'https://microsoft.com.evil.example/',
      'https://notmicrosoft.com/',
      'not a url',
    ])
      expect(isTeamsInternalUrl(url)).toBe(false);
  });
});

describe('teamsUserAgent', () => {
  it('去掉 Electron 与应用名，保留 Chrome 版本', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) dtqd/0.4.0 Chrome/140.0.0.0 Electron/44.0.0 Safari/537.36';
    expect(teamsUserAgent(ua)).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    );
  });
});
