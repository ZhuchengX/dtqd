---
name: teams
description: Microsoft Teams（Dundee 学生 Microsoft 365）：只读查看最近聊天、聊天消息与团队频道消息
---

# Teams

Teams 随邮件设置里的「Dundee Outlook」登录（Microsoft 365 OAuth2）一起授权，经 Microsoft Graph 实时只读查询；不发消息、不落本地库。

## 命令（Bash 内 dela）

- `dela list_teams_chats '{"limit":20}'`：最近聊天（1:1、群聊、会议聊天），含 id、主题、成员
- `dela read_teams_messages '{"chatId":"19:...@thread.v2","limit":20}'`：读某个聊天的消息（最新在前）
- `dela read_teams_messages '{"teamId":"...","channelId":"19:...@thread.tacv2"}'`：读团队频道消息（可选能力）
- 翻页：把上一页返回的 `nextCursor` 原样作为 `cursor` 传回，chatId/teamId 保持不变
- `dela list_teams_channels '{}'`：已加入的团队与频道（可选能力）

## 指引

- 先 list_teams_chats 拿 chatId，不要猜 id
- 返回 NOT_CONFIGURED：用户还没用 Dundee Outlook 登录，或学校未同意该权限——如实转告，不要反复重试
- 频道消息需要学校管理员同意 ChannelMessage.Read.All；被拒时改读聊天（课程群聊通常在聊天里）
- 消息是学生个人资料：只在回答当前问题需要时读取，引用时注明发送人和时间，不外传
- 需要回复时帮用户起草文本，由用户自己在 Teams 里发送
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
