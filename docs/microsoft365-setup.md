# Dundee Outlook / Teams 接入说明（Microsoft 365）

DIICSU 学生账号是 `studentID@dundee.ac.uk`，属于 University of Dundee 的 Microsoft 365 租户，登录走 Microsoft SSO + MFA。微软已对 Exchange Online 关闭 IMAP/SMTP 的基本认证（账号密码直连），所以 DTQD 改用 **OAuth2 授权码 + PKCE**：

- 邮件：IMAP/SMTP **XOAUTH2**，接回原有同步、读信、发信流程（交大邮箱与第三方 IMAP 的密码登录保持不变）。
- Teams：经 **Microsoft Graph** 只读读取聊天与消息；团队频道消息是可选能力。

DTQD **不内置任何 client ID**，也不借用 Thunderbird 等第三方应用的 ID。需要先在 Azure（Microsoft Entra ID）注册一个属于邓途启迪自己的应用，把它的「应用程序（客户端）ID」填进 DTQD。注册应用免费，不需要订阅或绑卡。

## 一、熊祝成要做的 Azure 应用注册

1. 打开 <https://entra.microsoft.com> →「应用注册」（App registrations）→「新注册」。
   - 名称：`DTQD`（学生在授权页会看到这个名字）。
   - 受支持的账户类型：见下文「二、在哪个租户注册」选 A 或 B。
   - 重定向 URI：平台选 **「公共客户端/本机（移动和桌面）」**（Public client/native），填 **`http://localhost`**（就这几个字，不带端口和路径）。
2. 「身份验证」（Authentication）页：
   - 确认「移动和桌面应用程序」平台下有 `http://localhost`。
   - 「高级设置」→「允许公共客户端流」（Allow public client flows）设为 **是**。
   - **不要**创建客户端密码（client secret）：桌面应用是公共客户端，靠 PKCE 保护。
3. 「API 权限」（API permissions）→「添加权限」，全部选 **委托的权限（Delegated）**：

   | 资源                       | 权限                                         | 用途                                 | 需管理员同意？ |
   | -------------------------- | -------------------------------------------- | ------------------------------------ | -------------- |
   | Microsoft Graph            | `openid` `profile` `offline_access`          | 登录、取账号名、长期刷新             | 否             |
   | Microsoft Graph            | `User.Read`                                  | 读自己的基本资料                     | 否             |
   | Microsoft Graph            | `Chat.Read`                                  | 读 Teams 聊天（1:1、群聊、会议聊天） | 否             |
   | Office 365 Exchange Online | `IMAP.AccessAsUser.All`                      | IMAP 收信                            | 否             |
   | Office 365 Exchange Online | `SMTP.Send`                                  | SMTP 发信                            | 否             |
   | Microsoft Graph（可选）    | `Team.ReadBasic.All` `Channel.ReadBasic.All` | 列出已加入的团队与频道               | 否             |
   | Microsoft Graph（可选）    | `ChannelMessage.Read.All`                    | 读团队频道消息                       | **是**         |
   - `IMAP.AccessAsUser.All` / `SMTP.Send` 在门户里可能列在「我的组织使用的 API」（APIs my organization uses）→ **Office 365 Exchange Online** 下，也可能直接出现在 Microsoft Graph 委托权限列表里；任一处添加即可，DTQD 请求的 scope 固定是 `https://outlook.office.com/IMAP.AccessAsUser.All` 和 `https://outlook.office.com/SMTP.Send`。
   - 可选的频道权限只有在 DTQD 登录时勾选「同时读取 Teams 团队频道消息」才会请求；不勾选时登录不会因它卡在管理员审批上。

4. 「概述」（Overview）页复制 **应用程序（客户端）ID**（GUID）。
5. 在 DTQD：设置 / 邮件 →「Dundee Outlook」→ 粘贴 Client ID；租户保持 `organizations`（或填 `dundee.ac.uk`）→「登录」→ 在弹出的微软页面完成账号、密码与 MFA → 同意授权。

## 二、在哪个租户注册（A / B）

| 方案            | 做法                                                                                                                                          | 优点                                       | 风险                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **A（优先试）** | 用 Dundee 学生账号登录 Entra，在 Dundee 租户内注册，账户类型选「仅此组织目录中的帐户」；DTQD 租户填 `dundee.ac.uk`                            | 应用就在学校租户里，不算「外部第三方应用」 | 很多大学关闭了「用户可以注册应用」，可能根本建不了                                        |
| **B**           | 用熊祝成自己的 Microsoft 账号新建一个免费的 Entra 租户，在其中注册，账户类型选「任何组织目录中的帐户（多租户）」；DTQD 租户填 `organizations` | 不依赖学校设置，任何人都能注册             | Dundee 学生登录时是在同意一个**外部租户的未验证发布者应用**，最容易被学校策略拦下（见下） |

## 三、⚠ 风险：Dundee 租户可能禁止用户自行同意第三方应用 → 待实测

学校 IT 常见的设置，以及在 DTQD 里看到的提示：

| 学校侧设置                                       | 登录时的表现                                                         | DTQD 提示                                      | 出路                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 禁止用户同意（或只允许已验证发布者的应用）       | 微软页面显示「需要管理员批准」，错误码 `AADSTS90094` / `AADSTS65001` | 「学校租户要求管理员批准此应用」               | 走方案 A；或通过页面上的「请求批准」提交给 Dundee IT；或完成发布者验证（需要 Microsoft 合作伙伴账号）后再试 |
| 条件访问（要求受管设备 / 特定客户端）            | 登录后被拦截，`AADSTS53003`                                          | 「学校的条件访问策略阻止了本次登录」           | 只能请学校放行                                                                                              |
| 邮箱关闭 IMAP                                    | 授权成功但 IMAP 连接被拒                                             | 「Microsoft 登录成功，但 IMAP 连接被拒绝」     | 无法用 IMAP 收信；后续可评估改走 Graph `Mail.Read`                                                          |
| 关闭 SMTP AUTH（Exchange Online 新租户默认关闭） | 发信报 `5.7.139`                                                     | 「学校邮箱关闭了 SMTP 发信」                   | 在网页版 Outlook 发；或后续改走 Graph `Mail.Send`                                                           |
| 频道消息权限未获管理员同意                       | Graph 返回 403                                                       | 「ChannelMessage.Read.All 需要学校管理员同意」 | 改读聊天（`list_teams_chats`），课程群多在聊天里                                                            |

**结论：以上能否通过，只能用真实 Dundee 账号实测。** 建议先用一个团队成员的学生账号按方案 A → B 的顺序各试一次，把看到的错误码记下来。

## 四、技术说明（给维护者）

- 授权：`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`，`response_type=code`、`code_challenge_method=S256`、`redirect_uri=http://localhost`、`prompt=select_account`。登录窗是独立分区（`persist:microsoft-login`）的普通子窗口，与校园登录窗同款；回环重定向在网络层拦截取码，本机不起 HTTP 服务。
- 多资源：`/authorize` 一次请求 Outlook + Graph 两个资源的同意；`/token` 每次只换一个资源的令牌（先用授权码换 Outlook 令牌，Teams 再用同一个 refresh token 换 Graph 令牌）。
- 存储：refresh token 经 Electron `safeStorage` 加密写入 `userData/microsoft-oauth.bin`（与其他凭据同一做法）；access token 只在内存。微软轮换 refresh token 时立即写回。断开邮箱时一并删除。
- 服务器：IMAP `outlook.office365.com:993`（TLS），SMTP `smtp.office365.com:587`（STARTTLS）。XOAUTH2 的 user 取自 id_token 的 `preferred_username`，必须与邮箱 UPN 一致。
- Exchange Online 会自动把 SMTP 提交的邮件存入「已发送邮件」，所以 Microsoft 账号发信后不再 IMAP APPEND（待实测确认没有漏存）。
- 与原有邮件模块一致，服务器的「草稿」「已删除邮件」文件夹不在 DTQD 里显示（草稿与回收站是本地功能）。原模块为交大邮箱做的「首次同步清空服务器草稿箱」一次性迁移**对 Microsoft 账号跳过**，不会动学生在 Outlook 网页版/桌面版里的草稿。
- Teams 聊天列表按「最后一条消息时间」排序（`$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc`），无主题的 1:1 聊天另取成员名。
- 界面侧目前只在 preload 暴露 `dela.mail.getMicrosoftConfig / listTeamsChats / listTeamsMessages`，尚未做独立的 Teams 面板；agent 侧经 `dela list_teams_chats` 等命令使用。
- 代码：`src/main/mail/oauth.ts`（纯逻辑）、`microsoft.ts`（令牌）、`microsoft-login.ts`（登录窗）、`microsoft-account.ts`（接入流程）、`graph.ts`（Teams）；agent 命令在 `src/main/agent/domain/teams/`。

## 五、必须用真实 Dundee 账号才能验证的事项

- [ ] 方案 A / B 哪个能注册、能同意（是否出现 `AADSTS90094`）
- [ ] 登录窗内 MFA（Authenticator 推送 / 短信）是否正常完成，`http://localhost` 回调能否被拦截
- [ ] id_token 的 `preferred_username` 是否就是 `studentID@dundee.ac.uk`
- [ ] IMAP XOAUTH2 能否连接、同步文件夹与邮件
- [ ] SMTP XOAUTH2 能否发信；「已发送邮件」里是否自动有副本
- [ ] refresh token 过期后的刷新（约 1 小时 access token / 90 天滑动 refresh token）
- [ ] `list_teams_chats` / `read_teams_messages` 能否读到课程群聊；`$expand=lastMessagePreview` 排序与 `/chats/{id}/members` 在 `Chat.Read` 下是否可用
- [ ] 勾选频道后 `ChannelMessage.Read.All` 是否被要求管理员同意
