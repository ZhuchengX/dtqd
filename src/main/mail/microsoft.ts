// Dundee Outlook（Microsoft 365）令牌管理：refresh token 加密落盘（credentials.ts），
// access token 按资源只缓存在内存。邮件（IMAP/SMTP）与 Teams（Graph）是不同资源，各自换令牌，
// 共用同一个 refresh token；微软每次刷新可能轮换 refresh token，拿到新的立即写回。
import type { MailCredential, MicrosoftCredential } from '../credentials';
import {
  clearMicrosoftCredential,
  loadMicrosoftCredential,
  saveMicrosoftCredential,
} from '../credentials';
import type { MicrosoftConfigView } from '../../shared/mail';
import {
  DEFAULT_MICROSOFT_TENANT,
  MicrosoftAuthError,
  refreshAccessToken,
  resourceScopes,
  tokenUsable,
  type FetchLike,
  type MicrosoftResource,
  type TokenSet,
} from './oauth';
import { readMailSetting, writeMailSetting, type ImapSecret } from './store';

/** workspace_settings 键：当前邮箱账号的登录方式（缺省即密码）。 */
export const MAIL_AUTH_PROVIDER_KEY = 'mail-auth-provider';
export const MS_CLIENT_ID_KEY = 'mail-ms-client-id';
export const MS_TENANT_KEY = 'mail-ms-tenant';
export const MS_CHANNELS_KEY = 'mail-ms-channels';

export function mailUsesMicrosoft(): boolean {
  return readMailSetting(MAIL_AUTH_PROVIDER_KEY) === 'microsoft';
}

export function setMailAuthProvider(provider: 'password' | 'microsoft'): void {
  writeMailSetting(MAIL_AUTH_PROVIDER_KEY, provider);
}

export function saveMicrosoftAppConfig(clientId: string, tenant: string, channels: boolean): void {
  writeMailSetting(MS_CLIENT_ID_KEY, clientId);
  writeMailSetting(MS_TENANT_KEY, tenant);
  writeMailSetting(MS_CHANNELS_KEY, channels ? '1' : '0');
}

export function getMicrosoftConfig(): MicrosoftConfigView {
  let credential: MicrosoftCredential | null = null;
  try {
    credential = mailUsesMicrosoft() ? loadMicrosoftCredential() : null;
  } catch {
    credential = null;
  }
  return {
    clientId: readMailSetting(MS_CLIENT_ID_KEY) ?? '',
    tenant: readMailSetting(MS_TENANT_KEY) ?? DEFAULT_MICROSOFT_TENANT,
    channels: readMailSetting(MS_CHANNELS_KEY) === '1',
    signedIn: credential !== null,
    address: credential?.address ?? null,
  };
}

const accessTokens = new Map<MicrosoftResource, TokenSet>();
// 刷新串行化：并发刷新会让先返回的轮换 refresh token 被后写入的旧值覆盖。
let refreshChain: Promise<unknown> = Promise.resolve();

export function resetMicrosoftTokenCache(): void {
  accessTokens.clear();
}

/** 登录成功后预热缓存，避免紧接着的首次同步再刷新一次。 */
export function primeMicrosoftToken(resource: MicrosoftResource, token: TokenSet): void {
  accessTokens.set(resource, token);
}

export function forgetMicrosoftAccount(): void {
  resetMicrosoftTokenCache();
  try {
    clearMicrosoftCredential();
  } catch {
    // 凭据文件已不存在时忽略。
  }
}

export interface TokenDeps {
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  readonly load?: () => MicrosoftCredential | null;
  readonly save?: (credential: MicrosoftCredential) => void;
}

async function refreshFor(resource: MicrosoftResource, deps: TokenDeps): Promise<string> {
  const now = deps.now ?? Date.now;
  const cached = accessTokens.get(resource);
  if (tokenUsable(cached, now())) return cached!.accessToken;
  const credential = (deps.load ?? loadMicrosoftCredential)();
  if (!credential)
    throw new MicrosoftAuthError('未登录 Microsoft 365，请在邮件设置中用 Dundee Outlook 登录');
  if (resource === 'graph-channels' && !credential.channels) {
    throw new MicrosoftAuthError(
      '登录时未请求团队频道权限：请在邮件设置勾选「团队频道消息」后重新登录（该权限需学校管理员同意）',
      'channels_not_requested',
    );
  }
  const token = await refreshAccessToken(
    {
      clientId: credential.clientId,
      tenant: credential.tenant,
      refreshToken: credential.refreshToken,
      scopes: resourceScopes(resource),
    },
    deps.fetchImpl,
    now,
  );
  if (token.refreshToken && token.refreshToken !== credential.refreshToken) {
    (deps.save ?? saveMicrosoftCredential)({ ...credential, refreshToken: token.refreshToken });
  }
  accessTokens.set(resource, token);
  return token.accessToken;
}

/** 取某个资源的 access token：缓存有效直接返回，否则用 refresh token 换新。 */
export function getMicrosoftAccessToken(
  resource: MicrosoftResource,
  deps: TokenDeps = {},
): Promise<string> {
  const next = refreshChain.then(() => refreshFor(resource, deps));
  refreshChain = next.catch(() => {});
  return next;
}

/** 邮件各调用点统一取 IMAP 凭据：密码账号原样返回密码，Microsoft 账号返回 access token。 */
export async function resolveMailSecret(credential: MailCredential): Promise<ImapSecret> {
  if (!mailUsesMicrosoft()) return credential.password;
  return { accessToken: await getMicrosoftAccessToken('outlook') };
}

/** nodemailer 的 auth 参数：Microsoft 账号走 OAuth2（XOAUTH2），其余照旧用密码。 */
export async function resolveSmtpAuth(
  credential: MailCredential,
): Promise<{ user: string; pass: string } | { type: 'OAuth2'; user: string; accessToken: string }> {
  const secret = await resolveMailSecret(credential);
  return typeof secret === 'string'
    ? { user: credential.address, pass: secret }
    : { type: 'OAuth2', user: credential.address, accessToken: secret.accessToken };
}
