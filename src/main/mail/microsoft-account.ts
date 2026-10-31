// Dundee Outlook（Microsoft 365）账号接入：登录窗授权 → 换 Outlook 资源令牌 → IMAP XOAUTH2 试连 →
// 写账号行与加密的 refresh token。之后的同步、读信、发信沿用原有 IMAP/SMTP 流程，只是凭据换成 access token。
import type { WebContents } from 'electron';
import { z } from 'zod';
import type { MailConfigureInput, MailResult } from '../../shared/mail';
import { MICROSOFT_MAIL_SERVER } from '../../shared/mail';
import { saveMicrosoftCredential } from '../credentials';
import {
  primeMicrosoftToken,
  resetMicrosoftTokenCache,
  saveMicrosoftAppConfig,
  setMailAuthProvider,
} from './microsoft';
import { openMicrosoftLoginWindow } from './microsoft-login';
import {
  buildAuthorizeUrl,
  consentScopes,
  createPkcePair,
  createState,
  isValidClientId,
  normalizeTenant,
  parseRedirect,
  redeemAuthorizationCode,
  resourceScopes,
} from './oauth';
import { connectImap, friendlyError } from './store';
import { storeMailAccount } from './sync';

export async function configureMicrosoftMailAccount(
  sender: WebContents,
  input: MailConfigureInput,
): Promise<MailResult> {
  const login = input.microsoft;
  if (!login) return { ok: false, error: '缺少 Microsoft 登录参数' };
  const clientId = login.clientId.trim();
  if (!clientId) {
    return {
      ok: false,
      error:
        '需先在 Azure 注册应用，并把「应用程序（客户端）ID」填到这里（见 docs/microsoft365-setup.md）',
    };
  }
  if (!isValidClientId(clientId)) return { ok: false, error: '应用（客户端）ID 应为 GUID 格式' };
  let tenant: string;
  try {
    tenant = normalizeTenant(login.tenant);
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  const channels = login.channels === true;
  saveMicrosoftAppConfig(clientId, tenant, channels);

  const hint = input.address.trim().toLowerCase();
  const pkce = createPkcePair();
  const state = createState();
  try {
    const authorizeUrl = buildAuthorizeUrl({
      clientId,
      tenant,
      scopes: consentScopes(channels),
      state,
      codeChallenge: pkce.challenge,
      loginHint: z.email().safeParse(hint).success ? hint : undefined,
    });
    const redirect = await openMicrosoftLoginWindow(sender, authorizeUrl);
    const code = parseRedirect(redirect, state);
    // 换码只针对 Outlook 资源（IMAP/SMTP）；Teams 用同一个 refresh token 另换 Graph 令牌。
    const token = await redeemAuthorizationCode({
      clientId,
      tenant,
      code,
      verifier: pkce.verifier,
      // openid/profile 可随单一资源一起请求，确保返回 id_token（取邮箱 UPN）。
      scopes: ['openid', 'profile', ...resourceScopes('outlook')],
    });
    if (!token.refreshToken) {
      return {
        ok: false,
        error: '微软没有返回 refresh token（offline_access 未被同意），请重新登录',
      };
    }
    // XOAUTH2 的 user 必须与邮箱 UPN 一致：以令牌里的账号名为准，用户输入只作登录提示。
    const address = (token.idTokenClaims?.preferredUsername ?? hint).trim().toLowerCase();
    if (!z.email().safeParse(address).success) {
      return {
        ok: false,
        error: '无法从 Microsoft 登录结果确定邮箱地址，请在邮箱地址栏填写后重试',
      };
    }
    const client = connectImap(address, { accessToken: token.accessToken }, MICROSOFT_MAIL_SERVER);
    try {
      await client.connect();
    } catch (error) {
      return {
        ok: false,
        error: `Microsoft 登录成功，但 IMAP 连接被拒绝（学校可能关闭了 IMAP）：${friendlyError(error)}`,
      };
    } finally {
      client.close();
    }
    const stored = storeMailAccount(address, MICROSOFT_MAIL_SERVER, '');
    if (!stored.ok) return stored;
    resetMicrosoftTokenCache();
    saveMicrosoftCredential({
      address,
      clientId,
      tenant,
      refreshToken: token.refreshToken,
      channels,
      savedAt: new Date().toISOString(),
    });
    primeMicrosoftToken('outlook', token);
    setMailAuthProvider('microsoft');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}
