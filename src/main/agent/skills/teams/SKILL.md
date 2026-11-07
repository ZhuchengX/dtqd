---
name: teams
description: Microsoft Teams（Dundee 学生账号）：查本机 Teams 存档里的频道、群聊和会议聊天消息
---

# Teams

学生点侧栏 Teams 登录后，DTQD 每 30 分钟把新消息同步到本机存档。下面的命令只读这份存档，不联网，不能发消息。

## 命令（Bash 内 dela）

- `dela search_teams_archive '{"query":"coursework","limit":10}'`：按关键词搜消息和会话名，返回会话 id 和命中摘要
- `dela list_teams_archive '{"limit":30}'`：列出会话（最近更新的在前），可加 `"kind":"频道"`
- `dela read_teams_archive '{"id":"频道/xxx.md","limit":20}'`：读某个会话的消息（最新在前）；翻页把返回的 `nextOffset` 作为 `offset` 传回

## 指引

- 先搜索或列出拿到 id，不要猜 id；存档只到上次同步，回答时说明这一点，并引用发送人和时间
- 私聊默认隐藏：学生在 设置 › 重要事项 打开「私聊进入提取」后才能读。关着时不要用其他方式读 `teams/私聊`、`teams/其他` 和 `teams/最近更新.md`
- 返回 NOT_CONFIGURED：学生还没登录 Teams，或私聊开关没开；如实转告，不要反复重试
- 消息是学生个人资料，只在回答当前问题需要时读取，不外传
- 需要回复时帮学生起草文本，由学生自己在 Teams 里发送
- `list_teams_chats`、`read_teams_messages`、`list_teams_channels` 是 Microsoft Graph 命令，要自备 Azure 应用并登录 Microsoft 365，学生默认用不了，不要优先使用
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
