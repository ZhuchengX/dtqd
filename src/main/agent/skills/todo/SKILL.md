---
name: todo
description: 待办与 myDundee（Blackboard）作业：查询、创建、完成个人待办，跟踪作业提交状态与截止时间
---

# 待办与作业

个人待办与 myDundee（Blackboard）作业统一在 TODO 列表（命令与字段沿用上游 canvas 命名）。

## 命令（Bash 内 dela）

- `dela query_todos '{}'`：个人待办（含已完成开关）
- `dela query_assignments '{}'`：myDundee 作业与提交状态（按课程过滤）
- `dela save_todo`：创建/更新待办（标题、备注、截止时间）
- `dela remove_todo`：删除个人待办
- `dela refresh_todos '{}'`：手动同步作业

## 指引

- 作业只读：区分未完成、已提交、已批改、豁免、需重交；提交要用户本人在 myDundee 完成（Blackboard 上点 Submit，Save and Close 不算提交）
- 作业描述是 HTML，读取时返回剥离正文（query_assignments 返回 id，正文经 canvas 命令的资料读取获得）
- 截止时间临近需要提醒时，用 curriculum 的 create_event 写入日历；邓迪截止按英国时间，换算北京时间后写入
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
