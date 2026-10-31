<div align="center">

<picture>
  <img src="assets/DTQD_white_bg.png" alt="DTQD" width="160">
</picture>

</div>

---

<div align="center">

**DTQD · 面向 DIICSU 学生的本地 AI 学习工作台**

</div>

---

> [!IMPORTANT]
> **本项目基于 [Chang-Yo/Dela](https://github.com/Chang-Yo/Dela)（GPL-3.0-or-later）修改，修改日期 2026-10-31。** 修改摘要与源码获取方式见 [NOTICE.md](NOTICE.md)。
>
> **DTQD 为第三方工具，与中南大学、邓迪大学（University of Dundee）及中南大学邓迪国际学院（DIICSU）无官方关系**，不代表任何学校或学院立场。DTQD 只是学习辅助工具，不承诺任何成绩或结果。
>
> 下载、安装或使用 DTQD，即视为你已阅读并同意本项目的[使用条款](docs/terms.md)与[隐私条款](docs/privacy.md)（DTQD 版条款目前为草稿）。如果你不同意其中部分内容，可以跳过对应服务的配置、不提供该项凭据，从而仅使用其余功能；如果你不同意全部条款，请停止使用并卸载本软件。

DTQD 是邓途启迪基于开源项目 Dela 改造的本地 AI 学习工作台，面向中南大学邓迪国际学院（DIICSU）学生。

DTQD 的 Agent 内核沿用 Dela 的 Pi 架构。凭据经系统钥匙串加密后保存在本机，其余数据保存在本地，不上传 DTQD 服务器（DTQD 没有服务器）；联网只发生在你主动配置的服务之间：myDundee / Blackboard（University of Dundee）、Microsoft（Outlook / Teams），以及你自己配置的大模型服务。

## 功能概览

**所有侧栏功能入口可在 “设置 > 通用 > 导航入口” 中显示或隐藏；试验功能可在 “设置 > 通用 > 试验功能” 中开关。**

### 校园信息服务（DIICSU）

- **myDundee（Blackboard）课件**：同步课程资料，快捷预览与切换课件，可批量下载、添加到本地项目
- **Outlook 邮箱**：收信、写信与本地草稿；同时保留任意 IMAP/SMTP 邮箱的支持
- **Teams**（规划中）：课程群消息与文件的查看与归档
- **微信 / QQ 接收文件归档**（规划中）：把聊天里收到的课件、作业文件按课程整理进本地项目
- **全局搜索**：跨项目、会话、邮件、课程资料和设置搜索
- **TODO**：作业与待办提醒，支持月历与列表两种视图

### 学习辅导与科研

- **学习辅导 skills**：课程知识点讲解、作业思路引导、复习规划（引导你自己完成，不代写作业）
- **科研 skills**：文献检索与阅读、研究入门指引
- **DIICSU 资料 skills**：专业培养方案、学院政策等公开资料的检索与解读（以学院官方发布为准）

### 上游功能（DIICSU 暂无对应，默认隐藏）

以下是上游 Dela 面向上海交大的专属功能，DTQD 保留代码但**默认隐藏**，可在设置中重新打开：

- **课堂视频回看与下载**（交大课堂视频平台）：导航入口「课堂视频」默认隐藏；视频下载属于试验功能，默认关闭
- **水源社区**（交大论坛）：试验功能，默认关闭
- **交大课表**（教学信息网）：导航入口「课表」默认隐藏

### Agent 功能

DTQD 沿用 Dela 的 Agent 能力：支持导入第三方 skills 和接入 MCPs；提供自定义的 `web_search` 工具接入（如 DeepSeek、Brave、Google，默认关闭，需自备 API KEY）与免费的 `web_fetch` 工具（默认开启）；兼容大部分 Pi Packages 生态（扩展、skills、提示模板，来源支持 npm、git 与本地目录；扩展与 DTQD 同权限运行，安装前请确认来源可信）。

**remote project** 可以把远端服务器目录登记为项目：通过 SSH 建立连接后，上传 helper runtime 维持本机与服务器之间的稳定通道，Agent 的读写与命令直接在服务器上执行，远端目录变化实时同步到文件树。

### 工作台功能

- **Markdown 笔记编辑**：支持对 `.md` 文件即时渲染编辑，支持数学公式与 mermaid 流程图
- **文件编辑**：任意文本文件都能打开编辑，按内容而不是扩展名识别；1 MB 以上只读预览
- **内置终端**：在应用内直接打开终端（Windows 为 Git Bash），remote project 默认为 ssh

## 技术栈

![Electron](https://img.shields.io/badge/Electron-v44-47848F?style=for-the-badge&logo=electron&logoColor=white&labelColor=1F2328)
![React](https://img.shields.io/badge/React-v19-087EA4?style=for-the-badge&logo=react&logoColor=white&labelColor=1F2328)
![TypeScript](https://img.shields.io/badge/TypeScript-v7-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=1F2328)
![Vite](https://img.shields.io/badge/Vite-v8-646CFF?style=for-the-badge&logo=vite&logoColor=white&labelColor=1F2328)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white&labelColor=1F2328)
![Pi](https://img.shields.io/badge/Pi-v1.1-1E293B?style=for-the-badge&logoColor=white&labelColor=1F2328)
![Go](https://img.shields.io/badge/Go-v1.22-00ADD8?style=for-the-badge&logo=go&logoColor=white&labelColor=1F2328)

## 下载安装

DTQD 安装包的分发渠道：**待定**。分发安装包时会同时提供对应源码（GPL-3.0 要求）。

DTQD 版**默认关闭应用内更新**（上游 Dela 的更新源已停用，避免被“更新”回 Dela）；DTQD 自有更新渠道确定后再开启。

## 本地开发

推荐使用 [`.node-version`](.node-version) 指定的 Node.js 与 [`package.json`](package.json) 的 `packageManager` 指定的 pnpm，兼容范围见 `engines`（本机可用 `. ./scripts/use-local-tools.ps1` 启用仓库内固定版本）：

```sh
pnpm install
pnpm dev
```

| 命令                | 用途                                                  |
| ------------------- | ----------------------------------------------------- |
| `pnpm dev`          | 启动开发服务器和窗口，监听主进程/preload 变更         |
| `pnpm build`        | 类型检查与 main/preload/renderer 三入口生产构建       |
| `pnpm test`         | Vitest 单元测试                                       |
| `pnpm smoke`        | Electron 内 SQLite、React 渲染与 preload 隔离冒烟检查 |
| `pnpm package:dist` | 生成 Windows 安装包                                   |

环境搭建细节、冒烟测试与代码组织约定见 [开发文档](docs/DEVELOPMENT.md)；版本与发布流程同样在其中。

## 文档

| 文档                               | 内容                               | 读者           |
| ---------------------------------- | ---------------------------------- | -------------- |
| [开发文档](docs/DEVELOPMENT.md)    | 架构、各子系统约定、构建与发布流程 | 贡献者（先读） |
| [使用条款](docs/terms.md)          | 软件性质、责任划分与免责范围       | 使用者         |
| [隐私条款](docs/privacy.md)        | 数据存放位置与联网去向             | 使用者         |
| [更新日志](CHANGELOG.md)           | 按版本分节的变更记录               | 贡献者         |
| [贡献指南](CONTRIBUTING.md)        | 环境准备、提交规范与协作方式       | 贡献者         |
| [功能边界](docs/what-we-not-do.md) | 明确不做与需先讨论的功能           | 贡献者         |
| [安全策略](SECURITY.md)            | 漏洞报告渠道、支持范围与安全边界   | 使用者、贡献者 |
| [校园接口资料](docs/sjtu-apis.md)  | Canvas 实测数据结构与交大接口索引  | 贡献者         |
| [NOTICE](NOTICE.md)                | 上游项目、许可证与本 fork 修改摘要 | 使用者、贡献者 |

## 许可

本项目以 GNU General Public License v3.0（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。DTQD 是 Dela 的修改版，修改说明见 [NOTICE.md](NOTICE.md)。

Dela 的名称与 logo 等素材版权归原作者所有，不在 GPL 授权范围内，DTQD 已替换为自有名称与字标；上游代码版权归 Dela 原作者与贡献者所有。

## 上游致谢

DTQD 站在 Dela 的肩膀上。感谢原作者 **[ChangYo](https://github.com/Chang-Yo)** 与所有 [Dela 贡献者](https://github.com/Chang-Yo/Dela/graphs/contributors) 的开源工作。

![Contributors](https://contrib.rocks/image?repo=Chang-Yo/Dela 'Dela Contributors')

### 上游赞助鸣谢

以下是上游 Dela 项目的赞助鸣谢，原样保留：

<table>
  <tr>
    <td width="80" align="center" valign="middle">
      <img src="assets/sponsors/FRAMENEO_logo_black.png" width="44" alt="FRAMENEO logo">
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/"><strong>FRAMENEO</strong></a><br>
      为 Dela 的软件包分发提供免费的高速 CDN 服务。
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/">FRAMENEO Website</a>
    </td>
  </tr>
</table>

如果想支持上游 Dela 作者，请前往 [Dela 仓库](https://github.com/Chang-Yo/Dela)。
