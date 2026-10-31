# 中南「智学中南 · 在线课堂」(netclass.csu.edu.cn) 对接调研

> 调研日期：2026-10-31 · 方式：只读抓取公开前端（未登录、未输入任何账号、未绕过鉴权，对 netclass 共约 17 次请求）
> 目的：评估把 `src/main/vsjtu/`（交大 v.sjtu.edu.cn）改接到 DIICSU 学生实际使用的中南录播平台

标注约定：
- **前端可见**：在公开 JS / HTML 里直接看到
- **公开实测**：未登录状态下请求过，看到了真实响应
- **推断**：根据代码逻辑推出，没有直接证据
- **待登录实测**：必须由学生账号登录后才能确认

---

## 一、邓迪录播结论（一句话）

邓迪本部用 **Panopto**（门户 `dundee.cloud.panopto.eu`，接在 My Dundee / Blackboard 里，YuJa 已迁走），出处：[Lecture Capture Policy](https://www.dundee.ac.uk/corporate-information/lecture-capture-policy)、[CTIL Panopto KB](https://ctil.dundee.ac.uk/kb/panopto/)、[Panopto 学生指南](https://libguides.dundee.ac.uk/panopto-student)。**没有找到** DIICSU 课程用 Panopto 录课的官方证据。按 CEO 的判断，DIICSU 线下课在潇湘校区，由中南的录播系统拍摄和存储，所以对接目标是 netclass。团队档案里「2024-25 学年起全面使用 Panopto」这句：Panopto 属实，但「2024-25 起」这个起始时间在官方页面上没找到出处；而且它只适用于邓迪本部，不能当作 DIICSU 的事实。

---

## 二、netclass 登录与接口清单

### 2.1 平台画像

| 项 | 内容 | 标注 |
|---|---|---|
| 站点名 | 「在线课堂-智学中南」，前端 `window.targetCustomer = "csu"` | 前端可见 |
| 架构 | `/learn/*` 页面由服务端渲染（Thymeleaf）+ Vue2 + jQuery.ajax；资源库 `/rman/*`、统一平台 `/unifiedplatform/*`、登录 `/unifiedlogin/*`、排课 `/ipingestman/*`。这套多租户 SaaS 也在给上海科大、cau、长安大学等学校用（代码里有 `shangHaiTech`、`cau`、`caxt.chd.edu` 分支） | 前端可见 |
| 校区 | `window.campusList` 里有 **潇湘校区**（教学楼包括 A/B/C/D 座、机电楼、数理楼、外语网络楼等） | 公开实测 |
| **DIICSU 在库** | `GET /learn/courseSearch`（未登录可访问）返回 42 个学院，其中有 `{"organizationCode":"edu_001001002045","organizationName":"邓迪国际学院","extend":{"courseUse":"true"}}` → DIICSU 是 netclass 的一个开课单位，列表接口可以用 `college=edu_001001002045` 过滤。是否每门课都有录像仍待登录实测 | 公开实测 |
| 节次时间表 | `GET /unifiedplatform/v1/base/data/database/select/course/time?isForCampus=true`（未登录可访问）返回校历 `timeDetailsShows`：第1节 08:00–08:45、2 08:55–09:40、3 10:00–10:45、4 10:55–11:40、5 14:00–14:45、6 14:55–15:40、7 16:00–16:45、8 16:55–17:40、9 19:00–19:45、10 19:55–20:40、11 21:00–21:45、12 21:55–22:40（看到的那份名为「2024-2025校历」，有 `campusInfo` 校区映射；是否有多份校历、潇湘校区用哪份待核） | 公开实测 |
| 学期 | `window.schoolYearList`：`{schoolYear:"2026-2027", semester:"秋季", startTime, endTime, showSemester:"2026-2027-1"}` 等，已嵌在列表页 HTML 里 | 公开实测 |
| 公开 JS | `/learn/static/js/bundle/common.js`（4.3MB，里面有全局 `API.*`，共 346 个接口）、`video_review_index.js`（列表页）、`video_review_detail.js`（详情/播放页）、`multi_view_player/dist/index.js`（多画面播放器，基于 xgplayer，支持 mp4/flv/m3u8） | 前端可见 |

### 2.2 登录 / 鉴权

| 项 | 内容 | 标注 |
|---|---|---|
| 登录入口 | `GET /unifiedlogin/v1/loginmanage/login/direction?redirect_url=<回跳地址>`（前端 `loginHref`） | 前端可见 |
| 跳转 CAS | 上面这个地址会 302 到 `https://ca.csu.edu.cn:443/authserver/login?service=https://netclass.csu.edu.cn/unifiedlogin/v1/cas/login?redirect_url=<回跳>`，也就是**中南统一身份认证（CAS / authserver）** | 公开实测 |
| CAS 回调 | `https://netclass.csu.edu.cn/unifiedlogin/v1/cas/login?redirect_url=...`，它校验 ticket 后在 netclass 域写下会话 Cookie，再跳回 `redirect_url` | 回调地址实测；写 Cookie 是推断 |
| 鉴权方式 | 所有 ajax 都带 `xhrFields.withCredentials: true` → **主要靠 Cookie**。另外如果 `localStorage["x-cas-token-app"]` 有值，会额外带请求头 **`x-cas-token`**（App/H5 内嵌场景） | 前端可见 |
| Cookie 名 | 前端拿不到（推测是 HttpOnly）；匿名访问只看到 `videoreviewSize`（无关）。会话 Cookie 名称和有效期 | **待登录实测** |
| 未登录信号 | `GET /learn/login/info` → `{"status":401,"message":"unLogin"}`；前端把业务码 `"401"` 或 `"course_0000_0002"` 当作未登录处理。详情页 `/learn/videoreview/{courseId}` 未登录时服务端 **302** 到登录入口 | 公开实测（HTTP 状态码是 200 还是 401 待确认） |
| 身份探测 | `GET /learn/login/info`（取当前用户，字段含 `nick_name`、`avatar`）；也可以用 `GET /unifiedplatform/v1/user/current` | 前端可见；字段待登录实测 |
| 心跳 / 登出 | `GET /unifiedplatform/v1/user/heartbeat`、`GET /unifiedlogin/v1/loginmanage/loginout/go` | 前端可见 |

### 2.3 视频相关接口

| # | 用途 | 方法 + 路径 | 参数 / 返回 | 标注 |
|---|---|---|---|---|
| 1 | **回看课程列表** | `GET /learn/v1/course/video/review/{type}` | query 就是题目里那个 URL 的参数：`type`（-1=全部 / 1=我参与的 / 2=公开课堂）、`courseName`、`teacherName`、`campus`、`academicBuilding`、`classroom`、`orderBy`（`join_time`/`course_name`）、`isDesc`、`schoolYear`（`2026-2027`）、`semester`（`秋季`/`春季`）、`college`、`educational`、`start_time`/`finish_time`（秒级时间戳）、`playType`、`courseTime`（由日期选择器逻辑推断：`1`=已上课/回看，`0`=未开始）、`live`、`page`、`size`。返回 `{status:200, data:{page,size,total,totalPage,results:[...]}}` | 前端可见 + 公开实测（⚠ 未登录时 `type=-1`、`type=2` 都返回 `status:200,total:0`，**不报 401** → 会话过期会静默返回空列表，必须先调身份探测做门卫） |
| 1a | 列表项字段 | — | `id`、`courseId`、`courseName`、`courseNumber`、`serialNumber`、`schoolYear`、`semester`、`showSemester`、`teacherList`/`teachers`（JSON 串 `{工号:姓名}`）、`colleges`、`campus`、`academicBuilding`、`classroomNumber`、`courseTimeData[]`、`thumbnail`、`live`、`collect`、`collectNumber` | 前端模板可见；类型和取值待登录实测 |
| 2 | **课程录像结构（按周/节）** | `GET /learn/v1/course/recording/video/info` | `courseId`、`id`、`schoolYear`、`semester`。返回 `data.recordingVideoInfoShows[]`（按周，有 `week`、`startTime`、`ifStart`）→ `recordInfoDetailList[]`（按节，有 `weekDay`、`realSection`、`section`、`ifStart`、`courseLiveInfo`）→ `videoInfoList[]`（有 `videoId`、`scheduleId`、`videoName`、`ifPublic`）；还有 `teacherList`、`coursePositionList`、`courseTime` | 前端可见 |
| 3 | **某节课的多机位视频** | `POST /rman/v1/search/relation/videos` | body = `scheduleId` 数组（JSON）。返回 `{success:1, data:{data:[{contentId_, seat, section, ...}]}}`，`seat` 是机位名（如「导切画面」「教师画面」「学生画面」「PPT画面」） | 前端可见 |
| 3b | 新版同上 | `POST /rman/v1/search/new/relation/videos` | 同上 | 前端可见（目前哪个在用待实测） |
| 4 | **播放地址** | `POST /rman/v1/entity/download/fileinfo` | body = `contentId` 数组。返回 `{success, data:[{contentId, downloadAddress:[相对路径]}]}`，播放器用 `baseUrl + downloadAddress[0]`，路径形如 `/bucket-z/u-xxx/video/2025/3/18/<hash>/0/<名>.mp4`（这个例子取自 bundle 里硬编码的其他学校演示数据，不代表中南的实际地址格式）；按扩展名选 mp4 / flv / m3u8 播放器 | 前端可见；媒体是否要 Cookie、是否带签名、是否支持 Range → **待登录实测** |
| 5 | **字幕（语音转写）** | `GET /rman/v1/search/webvtt?contentId={contentId}&voice=true&isSysAuth=true`；英文加 `&lang=en` | 返回 **WebVTT**。前端只在系统开关 `course_review_voice_show` 打开时挂字幕轨 | 前端可见；中南是否开启、有没有内容 → **待登录实测** |
| 5b | 语音文本 / 知识点搜索 | `GET /learn/v1/homepage/video/text`、`GET /learn/v1/search/history/voice/knowledge/point` | 参数未细看 | 前端可见 |
| 6 | 回看权限 | `GET /learn/v1/course/have/permission?courseId=` | — | 前端可见 |
| 7 | 观看进度 | `GET/POST /learn/v1/video/history`、`/learn/online/classroom/watch/duration` | 不必接 | 前端可见 |
| 8 | 按教室和时间取视频（cau 分支） | `POST /learn/v1/course/getVideoUrl` `{clroCode,startTime,endTime}` | 中南大概率不走这条 | 前端可见 |
| 9 | 学期下拉 / 节次 / 学院 | `GET /learn/v1/dropdownbox/semester/manage/list`、`/unifiedplatform/v1/base/data/database/get/semester/by/name` | 也可以直接解析列表页 HTML 里的 `window.schoolYearList` | 前端可见 |
| 10 | 水印 | `GET /unifiedplatform/v1/setting/watermark` | 官方播放器叠加水印 → 下载/导出功能有合规考量 | 前端可见 |

调用链：列表(1) → 选课 → 结构(2) 拿到每节课的 `scheduleId` → 机位(3) 拿到 `contentId_` + `seat` → 地址(4) 拿到 `downloadAddress` → 字幕(5) 用同一个 `contentId`。

---

## 三、vsjtu 模块改造点清单

现有 `vsjtu` 的数据模型是「课程 → 一节录像(id:number) → 若干画面(view:number)」。netclass 是「课程(courseId) → 周/节 → scheduleId → 多机位 contentId(32 位 hex 字符串)」。主要难点是**标识类型从 number 变成 string**，这会改到 shared 类型、IPC、播放代理和 renderer。

### 3.1 `src/main/vsjtu/api.ts`

| # | 现有符号 | 改法 | 难度 |
|---|---|---|---|
| 1 | `VIDEO_HOME`（v.sjtu…-ui/） | 改成 `https://netclass.csu.edu.cn/learn/videoreview` | 低 |
| 2 | `BASE`（…/resourcemanage/v1） | 拆成 `ORIGIN = https://netclass.csu.edu.cn`，路径分 `/learn/v1`、`/rman/v1` 两个前缀 | 低 |
| 3 | `ME`（/authority/me） | 改成 `/learn/login/info` | 低 |
| 4 | `requestOptions` / `identityOptions` | `service:'中南在线课堂'`、`Referer` 改 netclass；去掉 `loginStatus:500`（中南未登录返回 body `status:401`，HTTP 码待实测） | 低 |
| 5 | `requestOnce` | 删掉 Canvas 兜底分支（`loadCanvasToken`/`loginWithCanvas`）；要支持 **POST JSON body**（接口 3、4 是 POST），给 `campusRequest` 传 `method:'POST'`、`body`、`Content-Type` | 中 |
| 6 | `requestJson` 的去重 key | POST 时 key 要包含 body | 低 |
| 7 | `loginWithCanvas` / `hiddenCampusLogin` 调用 | **整段删除**：中南没有 Canvas LTI 免密通道。登录只能走 CAS 登录窗 | 低 |
| 8 | `checkIdentity` | 改成判断 `status===200 && data` 有用户字段（字段名待实测） | 低 |
| 9 | `unwrap` | 兼容两种信封：`/learn` 是 `{status,message,data}`，`/rman` 是 `{success,data}`；`status` 为 401 或 `course_0000_0002` 时抛 loginError | 中 |
| 10 | `allPages` | 分页参数从 `page.pageIndex/pageSize` 改成 `page`/`size`，结束条件改成 `data.total`/`totalPage` | 低 |
| 11 | `listCourses` | 改成：先取学期（解析 `window.schoolYearList`，或调 `/learn/v1/dropdownbox/semester/manage/list`）选当前学期 → `GET /learn/v1/course/video/review/1?type=1&schoolYear&semester`（「我参与的」）→ 映射成 `VideoCourse{id:courseId, code:courseNumber, name:courseName}`；还要带上列表项的 `id`（详情接口需要）。**必须保留开头的 `await checkVideoLogin()`**（未登录时列表返回空而不报错，见接口 1） | 中 |
| 12 | `listVideos(courseId)` | 改成调接口 2，把 周×节 展平成 `ClassroomVideo`：`start/end` 用周 `startTime` + `weekDay` + `realSection` 推算（要中南节次时间表），`room` 用 `coursePositionList`，`period` 用 `realSection`；只保留 `ifStart!=0` 且有 `videoInfoList` 的节。方案 A：用公开节次表（见 2.1）算出绝对起止时间；**方案 B（推荐，降为中）**：`ClassroomVideo` 改为带 `week/weekDay/section` 标签，renderer 直接显示「第 X 周 周几 第 N 节」（中南官方前端就是这么显示的），不依赖节次表 | 高（方案 A）/ 中（方案 B） |
| 13 | `parseStreams` | 改成解析接口 3+4：`view` 从数字改成 `seat` 机位名（或映射成序号）；host 白名单从 `live.sjtu.edu.cn` 改成 `netclass.csu.edu.cn`，而且要支持**相对路径拼接**；`.mp4` 限制要放宽或明确只收 mp4（如果是 m3u8/flv，代理和下载都得重写） | **高** |
| 14 | `getStreams(videoId)` | 改成两步：`scheduleId` → POST relation/videos → POST download/fileinfo | 中 |
| 15 | `getTranscript` / `TRANSCRIPT_*` 缓存 | URL 改成 `/rman/v1/search/webvtt?contentId=…&voice=true&isSysAuth=true`；Cookie 监听域从 `v.sjtu.edu.cn` 改成 `netclass.csu.edu.cn`；返回的是**纯文本 VTT** 不是 JSON，不能走 `requestJson` 的 `JSON.parse` | 中 |
| 16 | `id = z.coerce.number()` 校验 | 改成字符串 id（`/^[0-9a-zA-Z_-]{1,64}$/` 之类） | 中（牵动全链） |

### 3.2 其他文件

| # | 文件 / 符号 | 改法 | 难度 |
|---|---|---|---|
| 17 | `vsjtu/transcript.ts` `parseTranscript` | 重写成 **WebVTT 解析**（`HH:MM:SS.mmm --> …` + 文本）；`formatSegments`/`safeFileName` 可以不动 | 中 |
| 18 | `shared/vsjtu.ts` | `VideoCourse.id`、`ClassroomVideo.id`、`VideoTranscript.videoId` 改成 string；`VideoStream.view` 改成 number 序号 + 新增 `label`（机位名） | 中（renderer 跟着改） |
| 19 | `vsjtu/playback.ts` | 路由正则 `/video/(\d+)/(\d+)` 改成允许 hex 字符串；`playbackToken`/`entries` 的 key 改成 string；`fetchUp` 要带 campus Cookie（媒体是否需要待实测）；URL TTL 按实测的签名有效期调整；如果是 HLS，要代理 m3u8 并改写分片地址（难度会升到高） | 中～高 |
| 20 | `vsjtu/ipc.ts` `vsjtu:connect` | 删掉 Canvas 分支；`openCampusLoginWindow({ title:'登录中南在线课堂', url: ORIGIN+'/unifiedlogin/v1/loginmanage/login/direction?redirect_url='+encodeURIComponent(VIDEO_HOME), reached: u => u.startsWith('https://netclass.csu.edu.cn/learn'), retryProbe:true, probe: checkVideoLogin+flush })` | 低 |
| 21 | `vsjtu/ipc.ts` 下载 | 文件名 `-画面${view}.mp4` 改用机位名；如果媒体不是 mp4 要改扩展名和 filter | 低 |
| 22 | `campus.ts` `campusCookie` 白名单 | 现在是 `['sjtu.edu.cn','dundee.ac.uk','login.microsoftonline.com']`，**必须加 `csu.edu.cn`**（同时覆盖 `ca.csu.edu.cn` 和 `netclass.csu.edu.cn`），不然 session Cookie 不会加密持久化，重启后就要重新登录 | 低 |
| 23 | `campus.ts` `campusRequest` | 现在把**任何重定向**都当成登录失效，这和中南「未登录 302」的行为一致，可以直接用；POST body 已经支持。不用改 | — |
| 24 | `vsjtu/test/*.test.ts` + renderer `features/classroom/*` 测试 | 夹具全部换成 netclass 响应样本（要登录后抓真实样本并脱敏） | 中 |
| 25 | 文案 | 「交大视频」改成「中南在线课堂」（api.ts 报错文案、settings search-index、GeneralSection） | 低 |

**登录能否复用 `openCampusLoginWindow`：可以。** 它在 `persist:dela-campus` 分区开一个可见窗口，学生自己在 `ca.csu.edu.cn` 输入账号密码，Dela 不碰凭据。回跳到 `netclass.csu.edu.cn/learn/...` 之后，`reached` 命中，再用 `/learn/login/info` 探测。CAS 回调和 SPA 异步登录都被 `retryProbe:true`（每秒重新探测）覆盖。唯一必须改的是第 22 条 Cookie 白名单。`hiddenCampusLogin`（Canvas 免密）对中南用不上。

**改造量估计：** 共 **25 项**：低 **12**（1,2,3,4,6,7,8,10,20,21,22,25）、中 **9**（5,9,11,14,15,16,17,18,24）、高 **2**（12 选方案 A 时、13）、中～高 **1**（19，HLS 时为高）、不用改 **1**（23）。如果第 12 条选方案 B，高只剩 1 项。如果实测发现媒体就是普通 mp4 + Cookie 鉴权，主线程估计 **2–3 人日**（含测试夹具）；如果是 m3u8 + 签名 URL，要再加 **1–2 人日**。

---

## 四、需要熊祝成（或一名 DIICSU 学生）登录后实测的项

请在浏览器登录 netclass 后，打开 DevTools → Network，按下面顺序操作并导出 HAR（**导出前删掉 Cookie / x-cas-token 的值**），或者截图对应的请求和响应：

1. **能不能看到 DIICSU 自己的课**：公开接口已确认「邓迪国际学院」是 netclass 的开课单位，但还要确认：在「在线课堂 → 我参与的」（type=1）、2026-2027 秋季下，能否看到本学期 DIICSU 课程？有几门？是不是全部课都有录像？这一条决定方案是否真正可用。另外请顺带看未登录时 `type=1` 返回的是空列表还是 401。
2. 登录完成后 netclass 域下的**会话 Cookie 名**、有效期（是否 session-only）、`localStorage["x-cas-token-app"]` 有没有值。
3. `/learn/login/info` 登录后返回的字段（用来判断已登录），以及未登录时 **HTTP 状态码**是 200 还是 401。
4. `/learn/v1/course/video/review/1` 的一条 `results` 完整样本（`id`、`courseId` 的格式）。
5. 打开一门课的详情页：`/learn/v1/course/recording/video/info` 的响应样本（周、节、`scheduleId`、`videoId` 的格式）。
6. 点开一节课播放：`/rman/v1/search/relation/videos` 和 `/rman/v1/entity/download/fileinfo` 的请求 body 和响应；**媒体 URL 是 mp4 / m3u8 / flv？有没有签名参数和过期时间？不带 Cookie 能否直接打开？支不支持 Range？**
7. 播放器里有没有「字幕/CC」按钮：`/rman/v1/search/webvtt?...` 能否返回中文 VTT、质量如何；英文 `lang=en` 有没有内容。
8. 节次时间表已经从公开接口拿到（见 2.1），只需确认潇湘校区用的是不是那份校历（只有第 12 条选方案 A 时才需要）。
9. 合规：官方播放器有水印（`/unifiedplatform/v1/setting/watermark`）。在 Dela 里**下载**录像是否违反中南的使用规定，要先确认，再决定是否保留下载功能（建议默认只做在线播放 + 字幕）。
