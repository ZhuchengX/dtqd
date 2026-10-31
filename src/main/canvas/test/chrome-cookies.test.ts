import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptChromeValue,
  deriveChromeKey,
  isDundeeHost,
  toElectronCookie,
  type ChromeCookieRow,
} from '../chrome-cookies';

const key = deriveChromeKey('peanuts');
const encrypt = (plain: Buffer) => {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()]);
};

describe('isDundeeHost', () => {
  it('只认 dundee.ac.uk 及其子域', () => {
    expect(isDundeeHost('my.dundee.ac.uk')).toBe(true);
    expect(isDundeeHost('.dundee.ac.uk')).toBe(true);
    expect(isDundeeHost('evil-dundee.ac.uk')).toBe(false);
    expect(isDundeeHost('dundee.ac.uk.example.com')).toBe(false);
  });
});

describe('decryptChromeValue', () => {
  it('解开 v10 密文；版本 24 起去掉 32 字节主机哈希前缀', () => {
    expect(decryptChromeValue(encrypt(Buffer.from('abc')), key, 23)).toBe('abc');
    const hash = createHash('sha256').update('my.dundee.ac.uk').digest();
    const withHash = encrypt(Buffer.concat([hash, Buffer.from('session-1')]));
    expect(decryptChromeValue(withHash, key, 24)).toBe('session-1');
  });

  it('拒绝未知格式与错误口令', () => {
    expect(() => decryptChromeValue(Buffer.from('v20xxxx'), key, 24)).toThrow();
    expect(() =>
      decryptChromeValue(encrypt(Buffer.from('abc')), deriveChromeKey('wrong'), 23),
    ).toThrow();
  });
});

describe('toElectronCookie', () => {
  const base: ChromeCookieRow = {
    host_key: 'my.dundee.ac.uk',
    name: 'BbRouter',
    value: '',
    encrypted_value: Buffer.alloc(0),
    path: '/',
    expires_utc: 0,
    is_secure: 1,
    is_httponly: 1,
    samesite: -1,
    last_access_utc: 0,
  };

  it('仅限主机的会话 Cookie 不带 domain 与过期时间', () => {
    expect(toElectronCookie(base, 'x')).toEqual({
      url: 'https://my.dundee.ac.uk/',
      name: 'BbRouter',
      value: 'x',
      path: '/',
      secure: true,
      httpOnly: true,
    });
  });

  it('域 Cookie 带 domain，Chrome 时间换成 Unix 秒，samesite 映射', () => {
    const cookie = toElectronCookie(
      { ...base, host_key: '.dundee.ac.uk', expires_utc: 13_400_000_000_000_000, samesite: 1 },
      'y',
    );
    expect(cookie).toMatchObject({
      url: 'https://dundee.ac.uk/',
      domain: '.dundee.ac.uk',
      sameSite: 'lax',
      expirationDate: 13_400_000_000 - 11_644_473_600,
    });
  });
});
