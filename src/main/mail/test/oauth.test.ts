// Microsoft 365 OAuth2：授权 URL / PKCE、回调解析、令牌响应解析与刷新、XOAUTH2 SASL 串。
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  buildXoauth2,
  consentScopes,
  createPkcePair,
  decodeIdToken,
  explainAadError,
  MICROSOFT_REDIRECT_URI,
  MicrosoftAuthError,
  normalizeTenant,
  parseRedirect,
  parseTokenResponse,
  pkceChallenge,
  redeemAuthorizationCode,
  refreshAccessToken,
  resourceScopes,
  tokenUsable,
  type FetchLike,
} from '../oauth';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';

function fakeIdToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.`;
}

describe('PKCE', () => {
  it('verifier 为 43 位 base64url，challenge = BASE64URL(SHA256(verifier))', () => {
    const pair = createPkcePair(() => Buffer.alloc(32, 7));
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = createHash('sha256').update(pair.verifier).digest('base64url');
    expect(pair.challenge).toBe(expected);
  });

  it('RFC 7636 附录 B 测试向量', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('每次生成不同的 verifier', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe('buildAuthorizeUrl', () => {
  it('授权码 + PKCE S256 + 回环重定向，默认 organizations 租户', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: CLIENT_ID,
        scopes: consentScopes(false),
        state: 'state-1',
        codeChallenge: 'challenge-1',
        loginHint: '2400001@dundee.ac.uk',
      }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    );
    const params = url.searchParams;
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('redirect_uri')).toBe(MICROSOFT_REDIRECT_URI);
    expect(params.get('code_challenge')).toBe('challenge-1');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')).toBe('state-1');
    expect(params.get('login_hint')).toBe('2400001@dundee.ac.uk');
    const scopes = params.get('scope')!.split(' ');
    expect(scopes).toEqual(
      expect.arrayContaining([
        'offline_access',
        'openid',
        'https://outlook.office.com/IMAP.AccessAsUser.All',
        'https://outlook.office.com/SMTP.Send',
        'https://graph.microsoft.com/Chat.Read',
        'https://graph.microsoft.com/User.Read',
      ]),
    );
    // 未勾选时不请求需要管理员同意的频道权限，避免整次登录被管理员审批卡住。
    expect(scopes).not.toContain('https://graph.microsoft.com/ChannelMessage.Read.All');
  });

  it('勾选频道后才请求 ChannelMessage.Read.All；可指定租户域名', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: CLIENT_ID,
        tenant: 'dundee.ac.uk',
        scopes: consentScopes(true),
        state: 's',
        codeChallenge: 'c',
      }),
    );
    expect(url.pathname).toBe('/dundee.ac.uk/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toContain('ChannelMessage.Read.All');
    expect(url.searchParams.has('login_hint')).toBe(false);
  });

  it('拒绝非 GUID 的 client ID 与非法租户', () => {
    expect(() =>
      buildAuthorizeUrl({ clientId: 'thunderbird', scopes: [], state: 's', codeChallenge: 'c' }),
    ).toThrow(MicrosoftAuthError);
    expect(() => normalizeTenant('../evil')).toThrow(MicrosoftAuthError);
    expect(normalizeTenant('')).toBe('organizations');
  });
});

describe('resourceScopes', () => {
  it('每个令牌请求只含一个资源的 scope', () => {
    const outlook = resourceScopes('outlook');
    expect(outlook.filter((scope) => scope.includes('graph.microsoft.com'))).toEqual([]);
    expect(outlook).toContain('offline_access');
    const graph = resourceScopes('graph');
    expect(graph.filter((scope) => scope.includes('outlook.office.com'))).toEqual([]);
    expect(resourceScopes('graph-channels')).toContain(
      'https://graph.microsoft.com/ChannelMessage.Read.All',
    );
  });
});

describe('parseRedirect', () => {
  it('取出授权码', () => {
    expect(parseRedirect('http://localhost/?code=abc&state=s1', 's1')).toBe('abc');
  });

  it('state 不一致即拒绝', () => {
    expect(() => parseRedirect('http://localhost/?code=abc&state=other', 's1')).toThrow(/state/);
  });

  it('管理员同意要求翻译成中文提示', () => {
    expect(() =>
      parseRedirect(
        'http://localhost/?error=access_denied&error_description=AADSTS90094%3A+admin+approval&state=s1',
        's1',
      ),
    ).toThrow(/管理员/);
  });
});

describe('explainAadError', () => {
  it('常见 AADSTS 码', () => {
    expect(explainAadError('invalid_client', 'AADSTS700016: app not found')).toMatch(/Client ID/);
    expect(explainAadError('invalid_request', 'AADSTS50011: redirect')).toMatch(/localhost/);
    expect(explainAadError('invalid_grant', 'AADSTS70000')).toMatch(/重新登录/);
    expect(explainAadError('weird', 'line one\nline two')).toBe('Microsoft 登录失败：line one');
  });
});

describe('parseTokenResponse', () => {
  it('解析令牌、过期时间与 id_token 中的账号名', () => {
    const token = parseTokenResponse(
      {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: 'https://outlook.office.com/IMAP.AccessAsUser.All',
        id_token: fakeIdToken({ preferred_username: '2400001@dundee.ac.uk', tid: 'tenant-1' }),
      },
      1_000,
    );
    expect(token).toMatchObject({ accessToken: 'at', refreshToken: 'rt', expiresAt: 3_601_000 });
    expect(token.idTokenClaims).toEqual({
      preferredUsername: '2400001@dundee.ac.uk',
      name: null,
      tenantId: 'tenant-1',
    });
  });

  it('错误响应抛 MicrosoftAuthError 并带错误码', () => {
    try {
      parseTokenResponse({ error: 'invalid_grant', error_description: 'AADSTS700082: expired' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MicrosoftAuthError);
      expect((error as MicrosoftAuthError).code).toBe('invalid_grant');
      expect((error as Error).message).toMatch(/重新登录/);
    }
  });

  it('缺 access_token 视为失败；坏 id_token 不影响令牌', () => {
    expect(() => parseTokenResponse({ token_type: 'Bearer' })).toThrow(MicrosoftAuthError);
    expect(decodeIdToken('not-a-jwt')).toBeNull();
  });

  it('过期前 2 分钟即视为不可用', () => {
    const token = parseTokenResponse({ access_token: 'at', expires_in: 600 }, 0);
    expect(tokenUsable(token, 0)).toBe(true);
    expect(tokenUsable(token, 600_000 - 60_000)).toBe(false);
    expect(tokenUsable(undefined, 0)).toBe(false);
  });
});

describe('令牌端点请求', () => {
  function recordingFetch(response: unknown) {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, body: new URLSearchParams(init.body) });
      return { json: async () => response };
    });
    return { calls, fetchImpl };
  }

  it('换码带 code_verifier 与回环 redirect_uri，不带 client_secret', async () => {
    const { calls, fetchImpl } = recordingFetch({ access_token: 'at', refresh_token: 'rt' });
    await redeemAuthorizationCode(
      {
        clientId: CLIENT_ID,
        tenant: 'organizations',
        code: 'code-1',
        verifier: 'verifier-1',
        scopes: resourceScopes('outlook'),
      },
      fetchImpl,
    );
    expect(calls[0]!.url).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
    const body = calls[0]!.body;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('redirect_uri')).toBe('http://localhost');
    expect(body.has('client_secret')).toBe(false);
  });

  it('刷新：grant_type=refresh_token、指定资源 scope、返回轮换后的 refresh token', async () => {
    const { calls, fetchImpl } = recordingFetch({
      access_token: 'graph-at',
      refresh_token: 'rt-2',
      expires_in: 3600,
    });
    const token = await refreshAccessToken(
      {
        clientId: CLIENT_ID,
        tenant: 'organizations',
        refreshToken: 'rt-1',
        scopes: resourceScopes('graph'),
      },
      fetchImpl,
      () => 0,
    );
    const body = calls[0]!.body;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('scope')).toContain('https://graph.microsoft.com/Chat.Read');
    expect(token).toMatchObject({ accessToken: 'graph-at', refreshToken: 'rt-2' });
  });

  it('网络失败转成可读错误', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    await expect(
      refreshAccessToken(
        { clientId: CLIENT_ID, tenant: 'organizations', refreshToken: 'rt', scopes: [] },
        fetchImpl,
      ),
    ).rejects.toThrow(/无法连接 Microsoft/);
  });
});

describe('buildXoauth2', () => {
  it('按 SASL XOAUTH2 格式拼接并 base64', () => {
    const encoded = buildXoauth2('2400001@dundee.ac.uk', 'token-abc');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      'user=2400001@dundee.ac.uk\x01auth=Bearer token-abc\x01\x01',
    );
    // Microsoft 文档示例：user=test@contoso.onmicrosoft.com / EwBAAl3BAAUFFpUAo7J3Ve0bjLBWZWCclRC3EoAA
    expect(
      buildXoauth2('test@contoso.onmicrosoft.com', 'EwBAAl3BAAUFFpUAo7J3Ve0bjLBWZWCclRC3EoAA'),
    ).toBe(
      'dXNlcj10ZXN0QGNvbnRvc28ub25taWNyb3NvZnQuY29tAWF1dGg9QmVhcmVyIEV3QkFBbDNCQUFVRkZwVUFvN0ozVmUwYmpMQldaV0NjbFJDM0VvQUEBAQ==',
    );
  });
});
