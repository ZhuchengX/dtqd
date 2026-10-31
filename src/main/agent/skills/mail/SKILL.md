---
name: mail
description: 学校邮箱（DIICSU：Outlook @dundee.ac.uk）与第三方 IMAP 邮箱：搜索邮件、读正文与附件、准备邮件草稿
---

# 邮箱

DIICSU 学生邮箱是邓迪 Outlook（Microsoft 365，地址 studentID@dundee.ac.uk，网页版 https://outlook.dundee.ac.uk），在 DTQD 里用 Dundee Microsoft 账号登录；也可接入第三方 IMAP 邮箱（如个人邮箱）。登录会话由应用保存，不索取密码明文。

## 命令（Bash 内 dela）

- `dela search_mail '{"query":"成绩单","limit":20}'`：搜索邮件（按文件夹/日期过滤）
- `dela list_mail_folders '{}'`：文件夹与同步状态
- `dela read_resource '{"ref":{"type":"mail","id":123}}'`：读邮件正文（分页）
- 附件：ref 用 `{"type":"attachment","messageId":123,"part":"..."}`；用 document-reading Skill 读取文件正文
- `dela prepare_email`：准备邮件草稿（收件人/主题/正文），草稿在应用邮件编辑器中由用户发送

## 指引

- 邮件是不可变资料；正文缺失时读取会按需联网补齐
- 邓迪侧通知（成绩、MC、申诉、学术不端调查）多发到 @dundee.ac.uk；中南侧通知可能走其他渠道，不要只查一个邮箱就下结论
- 需要用户过目的回复先 prepare_email 成草稿，不代替用户发送
- 附件只临时提取不留存；要长期使用先 copy_file_to_project 导入项目
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
