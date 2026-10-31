---
name: canvas
description: myDundee（Blackboard）课程资料：课程与资料检索、作业要求阅读、把课件与资料关联进项目（命令名沿用 canvas）
---

# myDundee（Blackboard）课程资料

DIICSU 邓迪课程的课件、作业要求（Assignment Brief）、公告等在 myDundee（Blackboard，https://my.dundee.ac.uk）。查资料、读课件时用本 Skill。

- 登录：在 DTQD 里用 Dundee Microsoft 账号（studentID@dundee.ac.uk + MFA）登录；不索取密码、Cookie 或 Token
- 命令名沿用上游的 `*_canvas_*`（后端改接 Blackboard 中），`ref.type` 仍写 `canvas`
- DTQD 为第三方工具，非学院官方；以 myDundee 页面与 Module Handbook 为准

## 命令（Bash 内 dela）

- `dela get_canvas_status '{}'`：连接状态
- `dela list_canvas_courses '{}'`：已缓存课程列表
- `dela search_canvas_sources '{"query":"实验"}'`：按标题搜课程资料
- `dela refresh_canvas_courses` / `dela refresh_canvas_course`：同步课程（先同步后搜索）
- `dela read_resource '{"ref":{"type":"canvas","id":"file:123"}}'`：读资料页面正文；文件正文使用 document-reading Skill
- `dela link_canvas_source`：把资料作为来源引用加入项目
- `dela copy_file_to_project`：把资料复制为项目文件，长期使用

## 指引

- 只匹配缓存标题；先确认状态已连接、课程已同步；未连接时提示用户在 DTQD 中用 Dundee Microsoft 账号登录
- 实验报告、大作业的要求文档读完后，把要点整理进项目笔记，课件用 link 或 copy 挂进项目
- 作业截止时间见 TODO（query_assignments）；到期日可用 curriculum 的 create_event 写入日历
- 邓迪作业截止时间按英国时间，写日历时换算北京时间（+7/+8 小时）并提醒提前提交；作业的 AI 使用等级看 Assignment Brief，学术规则见 diicsu-policy
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
