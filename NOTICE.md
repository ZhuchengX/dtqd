# NOTICE

## 上游项目

| 项目     | 内容                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 上游名称 | Dela                                                                     |
| 上游仓库 | <https://github.com/Chang-Yo/Dela>                                       |
| 原作者   | ChangYo（<https://github.com/Chang-Yo>）及 Dela 全体贡献者               |
| 许可证   | GNU General Public License v3.0 or later（GPL-3.0-or-later），见 LICENSE |

本项目 DTQD 是 Dela 的修改版（modified version），依 GPL-3.0-or-later 第 5 条发布。LICENSE 文件原样保留，未作改动。上游代码的版权归 Dela 原作者与贡献者所有。

Dela 的名称、logo、开场视频等品牌素材版权归原作者所有，不在 GPL 授权范围内。DTQD 已替换为自有名称与字标，并从仓库和安装包中移除了这些素材及上游赞助商标识。

## 本 fork 的修改

- **修改方**：邓途启迪（DTQD）
- **修改日期**：2026-10-31（自上游提交 `22712ea` 起）
- **修改摘要**：
  - 品牌：产品名改为 DTQD（productName / appId `com.dtqd.desktop` / package name `dtqd`），界面可见的「Dela」字样改为 DTQD，新增 DTQD 字标图标（`assets/DTQD_*`），停用含上游品牌的开场视频。
  - 定位：面向中南大学邓迪国际学院（DIICSU）学生；myDundee（Blackboard）、Outlook / Microsoft、学习辅导与科研 skills 等为 DTQD 新增或改造的功能。
  - 外联：停用上游的应用内更新源（electron-builder `publish` 置空，应用内更新默认关闭）；关于页去掉上游官网与赞赏入口，保留「基于 Dela」致谢与上游仓库链接；`.github/FUNDING.yml` 注释停用。
  - 交大专属功能（课堂视频、水源、交大课表）代码保留，默认隐藏，可在设置中重新开启。
  - 文档：README 改写为 DTQD 版；使用条款与隐私条款改写为 DTQD 版。
- 逐文件的修改记录以本仓库 git 历史为准。

## 源码获取方式

DTQD 每个安装包对应的完整源码，在同一 GitHub Release 页面及对应的版本标签（tag）下提供：<https://github.com/ZhuchengX/dtqd>。Release 同时附 LICENSE 和本 NOTICE。如无法获取，请在 [GitHub Discussions](https://github.com/ZhuchengX/dtqd/discussions) 留言。

## 免责声明

DTQD 为第三方工具，与中南大学、邓迪大学（University of Dundee）及中南大学邓迪国际学院（DIICSU）无官方关系；与 Dela 原作者亦无隶属关系，DTQD 版的问题请勿报给上游作者。本程序不提供任何担保，详见 LICENSE 第 15、16 条。
