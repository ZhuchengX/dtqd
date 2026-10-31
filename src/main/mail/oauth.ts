// Microsoft identity platform（v2.0 端点）OAuth2 授权码 + PKCE 的纯逻辑：不碰 Electron、不碰磁盘，
// 只做 URL/PKCE/令牌请求与解析，便于单元测试。登录窗在 microsoft-login.ts，令牌持久化在 microsoft.ts。
//
// 关键约束（Microsoft 文档）：/authorize 一次可以为多个资源（Outlook + Graph）请求同意，
// 但每次 /token 请求（换码或刷新）只能指定同一个资源的 scope；同一个 refresh token 可换不同资源的 access token。
import { createHash, randomBytes } from 'node:crypto';

/** 公共客户端回环重定向；Azure 里登记在「移动和桌面应用程序」平台下。 */
export const MICROSOFT_REDIRECT_URI = 'http://localhost';
export const DEFAULT_MICROSOFT_TENANT = 'organizations';

/** IMAP/SMTP XOAUTH2 用的 Exchange Online 资源 scope。 */
export const OUTLOOK_MAIL_SCOPES = [
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
] as const;

/** Teams 聊天只读（用户可自行同意的委托权限）。 */
export const GRAPH_TEAMS_SCOPES = [
  'https://graph.microsoft.com/Chat.Read',
  'https://graph.microsoft.com/User.Read',
] as const;

/** 团队频道消息：ChannelMessage.Read.All 需要租户管理员同意，只在用户勾选后请求。 */
export const GRAPH_CHANNEL_SCOPES = [
  'https://graph.microsoft.com/Team.ReadBasic.All',
  'https://graph.microsoft.com/Channel.ReadBasic.All',
  'https://graph.microsoft.com/ChannelMessage.Read.All',
] as const;

export const OIDC_SCOPES = ['openid', 'profile', 'offline_access'] as const;

export type MicrosoftResource = 'outlook' | 'graph' | 'graph-channels';

export function resourceScopes(resource: MicrosoftResource): string[] {
  const base =
    resource === 'outlook'
      ? [...OUTLOOK_MAIL_SCOPES]
      : resource === 'graph'
        ? [...GRAPH_TEAMS_SCOPES]
        : [...GRAPH_TEAMS_SCOPES, ...GRAPH_CHANNEL_SCOPES];
  return [...base, 'offline_access'];
}

/** 登录时一次性请求同意的全部 scope（多资源合并只用于 /authorize）。 */
export function consentScopes(includeChannels: boolean): string[] {
  return [
    ...OIDC_SCOPES,
    ...OUTLOOK_MAIL_SCOPES,
    ...GRAPH_TEAMS_SCOPES,
    ...(includeChannels ? GRAPH_CHANNEL_SCOPES : []),
  ];
}

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// organizations / common / consumers、租户 GUID 或已验证域名（如 dundee.ac.uk）。
const TENANT_PATTERN = /^[a-z0-9][a-z0-9.-]{0,252}$/i;

export function isValidClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value.trim());
}

export function normalizeTenant(value: string | undefined | null): string {
  const tenant = (value ?? '').trim() || DEFAULT_MICROSOFT_TENANT;
  if (!TENANT_PATTERN.test(tenant)) throw new MicrosoftAuthError('租户（tenant）格式无效');
  return tenant;
}

function authority(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(normalizeTenant(tenant))}/oauth2/v2.0`;
}

/** 登录、刷新或 Graph 调用失败的可读错误；friendlyError 按 name 原样透出，不误报「密码错误」。 */
export class MicrosoftAuthError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MicrosoftAuthError';
    this.code = code;
  }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** RFC 7636：43~128 字符的 verifier，challenge = BASE64URL(SHA256(verifier))。 */
export function createPkcePair(random: (size: number) => Buffer = randomBytes): PkcePair {
  const verifier = base64Url(random(32));
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

export function createState(random: (size: number) => Buffer = randomBytes): string {
  return base64Url(random(16));
}

export interface AuthorizeUrlInput {
  readonly clientId: string;
  readonly tenant?: string;
  readonly scopes: readonly string[];
  readonly state: string;
  readonly codeChallenge: string;
  readonly redirectUri?: string;
  readonly loginHint?: string;
}

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  if (!isValidClientId(input.clientId)) throw new MicrosoftAuthError('应用（客户端）ID 格式无效');
  const url = new URL(`${authority(input.tenant ?? DEFAULT_MICROSOFT_TENANT)}/authorize`);
  const params = url.searchParams;
  params.set('client_id', input.clientId.trim());
  params.set('response_type', 'code');
  params.set('redirect_uri', input.redirectUri ?? MICROSOFT_REDIRECT_URI);
  params.set('response_mode', 'query');
  params.set('scope', input.scopes.join(' '));
  params.set('state', input.state);
  params.set('code_challenge', input.codeChallenge);
  params.set('code_challenge_method', 'S256');
  params.set('prompt', 'select_account');
  if (input.loginHint) params.set('login_hint', input.loginHint);
  return url.toString();
}

/** 回环重定向命中后解析 code；state 不符或带 error 时抛出可读错误。 */
export function parseRedirect(url: string, expectedState: string): string {
  const parsed = new URL(url);
  const error = parsed.searchParams.get('error');
  if (error) {
    throw new MicrosoftAuthError(
      explainAadError(error, parsed.searchParams.get('error_description') ?? ''),
      error,
    );
  }
  if (parsed.searchParams.get('state') !== expectedState) {
    throw new MicrosoftAuthError('登录回调校验失败（state 不一致），请重新登录');
  }
  const code = parsed.searchParams.get('code');
  if (!code) throw new MicrosoftAuthError('登录回调缺少授权码，请重新登录');
  return code;
}

/** 常见 AADSTS 错误码的中文解释；未知错误保留原始描述首行。 */
export function explainAadError(error: string, description: string): string {
  const aadsts = /AADSTS(\d+)/.exec(description)?.[1];
  switch (aadsts) {
    case '65001':
      return '该应用尚未获得所需权限的同意：请重新登录并同意授权；若页面提示需要管理员批准，则需学校 IT 同意此应用';
    case '90094':
    case '90095':
      return '学校租户要求管理员批准此应用（禁止用户自行同意第三方应用），需联系学校 IT 或改用租户内注册的应用';
    case '700016':
      return '应用（客户端）ID 在该租户中不存在：请检查 Client ID 与租户设置';
    case '50011':
      return '重定向 URI 不匹配：请在 Azure 应用注册的「移动和桌面应用程序」平台添加 http://localhost';
    case '7000218':
      return '应用未开启「允许公共客户端流」：请在 Azure 应用注册 › 身份验证中开启';
    case '70000':
    case '700082':
    case '50173':
      return 'Microsoft 登录已过期或被撤销，请重新登录';
    case '53003':
      return '学校的条件访问策略阻止了本次登录（可能要求受管设备或特定应用）';
  }
  if (error === 'access_denied') return '已取消授权或学校拒绝了授权';
  if (error === 'invalid_grant') return 'Microsoft 登录已过期或被撤销，请重新登录';
  if (error === 'consent_required' || error === 'interaction_required') {
    return '需要重新登录并同意授权';
  }
  const firstLine = description.split(/\r?\n/)[0]?.trim();
  return `Microsoft 登录失败：${firstLine || error}`;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number;
  readonly scope: string;
  readonly idTokenClaims: IdTokenClaims | null;
}

export interface IdTokenClaims {
  readonly preferredUsername: string | null;
  readonly name: string | null;
  readonly tenantId: string | null;
}

/** 只解码不验签：id_token 直接来自 TLS 连接的令牌端点，仅用于取显示用账号名。 */
export function decodeIdToken(token: string | undefined | null): IdTokenClaims | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const text = (key: string) => (typeof claims[key] === 'string' ? claims[key] : null);
    return {
      preferredUsername: text('preferred_username') ?? text('upn') ?? text('email'),
      name: text('name'),
      tenantId: text('tid'),
    };
  } catch {
    return null;
  }
}

// 过期前 2 分钟视为失效，避免长连接中途令牌到期。
const EXPIRY_SKEW_MS = 120_000;

export function parseTokenResponse(body: unknown, now: number = Date.now()): TokenSet {
  if (typeof body !== 'object' || body === null) {
    throw new MicrosoftAuthError('Microsoft 令牌端点返回了无法识别的响应');
  }
  const json = body as Record<string, unknown>;
  if (typeof json.error === 'string') {
    throw new MicrosoftAuthError(
      explainAadError(
        json.error,
        typeof json.error_description === 'string' ? json.error_description : '',
      ),
      json.error,
    );
  }
  if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
    throw new MicrosoftAuthError('Microsoft 令牌端点没有返回 access_token');
  }
  const expiresIn = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    scope: typeof json.scope === 'string' ? json.scope : '',
    idTokenClaims: decodeIdToken(typeof json.id_token === 'string' ? json.id_token : null),
  };
}

export function tokenUsable(token: TokenSet | undefined, now: number = Date.now()): boolean {
  return token !== undefined && token.expiresAt - EXPIRY_SKEW_MS > now;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ json(): Promise<unknown> }>;

const TOKEN_TIMEOUT_MS = 20_000;

async function postToken(
  tenant: string,
  form: Record<string, string>,
  fetchImpl: FetchLike,
  now: () => number,
): Promise<TokenSet> {
  let response;
  try {
    response = await fetchImpl(`${authority(tenant)}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch (cause) {
    throw new MicrosoftAuthError('无法连接 Microsoft 登录服务器，请检查网络', null, { cause });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new MicrosoftAuthError('Microsoft 令牌端点返回了无法识别的响应', null, { cause });
  }
  return parseTokenResponse(body, now());
}

export const defaultFetch: FetchLike = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) });

export interface RedeemCodeInput {
  readonly clientId: string;
  readonly tenant: string;
  readonly code: string;
  readonly verifier: string;
  readonly scopes: readonly string[];
  readonly redirectUri?: string;
}

export function redeemAuthorizationCode(
  input: RedeemCodeInput,
  fetchImpl: FetchLike = defaultFetch,
  now: () => number = Date.now,
): Promise<TokenSet> {
  return postToken(
    input.tenant,
    {
      client_id: input.clientId,
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri ?? MICROSOFT_REDIRECT_URI,
      code_verifier: input.verifier,
      scope: input.scopes.join(' '),
    },
    fetchImpl,
    now,
  );
}

export interface RefreshInput {
  readonly clientId: string;
  readonly tenant: string;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
}

export function refreshAccessToken(
  input: RefreshInput,
  fetchImpl: FetchLike = defaultFetch,
  now: () => number = Date.now,
): Promise<TokenSet> {
  return postToken(
    input.tenant,
    {
      client_id: input.clientId,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      scope: input.scopes.join(' '),
    },
    fetchImpl,
    now,
  );
}

/**
 * SASL XOAUTH2 初始响应（IMAP AUTHENTICATE XOAUTH2 / SMTP AUTH XOAUTH2）：
 * base64("user=" + 用户 + ^A + "auth=Bearer " + 令牌 + ^A^A)。ImapFlow 与 nodemailer 内部各自构造，
 * 此处留作诊断与测试的单一事实来源。
 */
export function buildXoauth2(user: string, accessToken: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`, 'utf8').toString(
    'base64',
  );
}
