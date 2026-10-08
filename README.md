# 💬 BetterLanTalk 内网聊天室系统（本地开发更新，基于 v1.1.1）

一个简单易用的内网聊天室系统，支持实时消息、好友私聊、群聊、用户账号体系、文件传输和管理员控制台。

> 本项目基于 [ChasonWang2012/LanTalk](https://github.com/ChasonWang2012/LanTalk)（MIT License）二次开发，在原项目基础上进行了功能增强与界面改造。原项目版权归原作者所有，详见 [LICENSE](LICENSE) 与下方「致谢」。

## ✨ 功能特性

### 原项目已有
- 💬 **实时聊天** - 基于 WebSocket 的即时消息
- 🏠 **多房间支持** - 创建和加入不同聊天室
- 📝 **支持 Markdown** - 完整的 Markdown 语法支持
- 🔇 **IP 禁言** - 管理员禁言违规用户
- 💻 **桌面界面** - 左侧源码、右侧实时预览，消息区直接渲染；支持桌面半屏及 9:16 窄窗口，侧栏可按需展开

### 本版本新增 / 增强
- 👥 **账号系统** - 用户名 + 密码注册 / 登录，密码使用 Node 内置 `crypto.scrypt` 加盐哈希存储；账号与设备 IP 一对一关联，同一 IP 只能使用一个账号，账号只能从其固定 IP 登录
- 🔐 **登录持久化** - 「记住我」后刷新页面自动登录，token 有效期 7 天
- 🛡️ **独立管理页** - 管理员通过聊天页的「管理」入口进入独立页面；页面及脚本、样式均由服务端校验权限，支持修改端口、单文件大小与存储总量上限
- 👥 **账号管理** - 初始账号为超级管理员，可设置或取消管理员；普通管理员可管理普通用户账号，不能修改其他管理员或超级管理员
- 🏠 **房间权限** - 仅管理员可创建房间；新账号仅加入默认群；其他公开群可查找后主动加入，私有群需管理员邀请；群定义及成员关系持久保存
- 👤 **好友与私聊** - 左侧显示好友与已加入的群聊，底部处理申请；右侧显示当前会话成员并可搜索加好友。支持接受、拒绝、撤回、删除好友，只有好友可发送私聊消息；解除好友后历史记录仍可查看
- 📎 **文件传输** - 图片直接显示在消息中（支持 Ctrl+V 粘贴上传），其他文件显示在右侧「房间文件」栏；单文件额度与存储总量可在管理面板调整，超出总量自动清理最早上传的文件（界面标记「已过期」）
- 🔔 **消息提醒** - 页面在后台或窗口失焦时，已授权的浏览器可弹出系统通知，点击后进入对应房间；其他房间的消息显示未读计数。系统通知需要 HTTPS 或 localhost 和浏览器授权，普通内网 HTTP 使用房间与标签页标题的未读提醒
- 🔔 **极域通知** - 默认关闭，直接使用账号关联的 IP；浏览器关闭或后台时向兼容学生端发送 `from 用户名: new message/new flie/new picture`，每台设备有 20 秒冷却，期间提醒直接丢弃
- 🌐 **免下载客户端** - 浏览器直接访问 `http://<服务器IP>:端口/` 即可使用，Socket.IO 客户端由服务器本地提供，无需外网 CDN
- 💻 **一键启动脚本** - `start.bat`（Windows）/ `start.sh`（Linux / macOS）
- ✨ **体验优化** - 用户进出改为右上角限时提示（不再刷屏）；页面刷新不再误报「离开 / 进入」；文件侧栏折叠；管理员广播等系统消息使用统一大消息框

## 🛠️ 技术栈

**后端:** Node.js + Express + Socket.IO。密码哈希、token 生成均使用 Node 内置 `crypto` 模块；运行时数据（账号、登录令牌、群成员、好友申请与关系、账号关联 IP、聊天记录、文件元数据、端口配置）存于 `server/*.json`。

**前端:** 原生 HTML5/CSS3/JavaScript，白灰简洁界面。登录入口为 `client/index.html`，聊天与管理分别在 `client/chat.html` 和 `client/admin.html`，样式、Luogu 解析器、KaTeX 字体和 Prism 代码高亮均由服务器本地提供，聊天无需外网 CDN。

### Luogu Markdown

聊天与实时预览使用 [wudream813/luogu-markdown-editor](https://github.com/wudream813/luogu-markdown-editor) v1.40.3 的原版解析器，两端共用解析及 HTML 清理逻辑。聊天输入区提供粗体、斜体、公式、代码、表格和折叠框插入按钮，以及左侧源码、右侧实时预览的桌面双栏编辑区；消息区直接显示渲染结果。工具栏复用上游图标，保留常用 Markdown 插入与撤销/重做，不提供排版修复、模板、导出或工作区功能。

- 支持 `$...$` / `$$...$$` LaTeX 公式、嵌套折叠框、对齐、引言、引用链接、脚注和任务列表。
- 表格中 `<` 向左合并，`^` 向上合并；支持 Luogu 表格扩展。
- 代码块可指定 `cpp line-numbers lines=2,4-6`；常见竞赛语言提供本地高亮，并可复制代码。
- 支持 `![](bilibili:BV号)`；只有点击播放器才连接 Bilibili，外部图片或视频仍需客户端能访问其来源。
- 文件按钮、拖拽附件、Ctrl+V 图片上传保留；图片仍显示在消息中，文件仍出现在房间文件栏。
- Enter 换行，Ctrl+Enter（macOS 也可用 Command+Enter）发送；中文输入法确认候选文字不会误发送。每条文字消息最多 20,000 字符。
- 消息气泡按内容收紧，宽屏最大 520px；窄窗口中好友列表与成员/文件栏可展开、收起，源码和预览始终保持左右对照。
- 编辑区顶部的拖动条可上下调整源码和预览的共同高度，设置会保留；双击恢复默认高度，也可聚焦拖动条后使用上下方向键调整。

上游 MIT 许可证和精确版本记录位于 `client/vendor/luogu-markdown-editor/`。解析器文件保持原样，聊天专用预览与交互在独立模块中实现。

## 🚀 快速开始

### 方式一：一键启动

- Windows：双击 `start.bat`
- Linux / macOS：`chmod +x start.sh && ./start.sh`

脚本会自动检测 Node.js、首次运行时安装依赖并启动服务器，随后自动用**本机内网 IP** 打开浏览器（如 `http://192.168.1.10:3001/`）。若本机有虚拟网卡（VPN / 代理 TUN 等）导致自动识别不准，可在管理面板的「服务器设置」里手动指定「对外 IP」。

### 方式二：手动启动

```bash
cd server
npm ci
node server.js
```

启动后控制台会打印访问地址，默认 `http://<服务器IP>:3001/`。

首次启动会在 `server/users.json` 中自动创建初始超级管理员：

```
admin / admin123
```

⚠️ 请登录后尽快在管理面板中修改管理员密码。

升级已有安装时，原来的初始管理员自动升级为超级管理员，用户名、密码与账号数据保留。

### 客户端使用

1. 浏览器直接访问 `http://<服务器IP>:3001/`（无需下载任何 html）
2. 首次使用点击「注册」创建账号（每个 IP 只能注册一个）
3. 登录后加入默认聊天室；通过右侧「添加好友」发起申请，接受后建立私聊，通过左侧「查找公开群」加入其他群
4. 管理员账号右上角有「管理」入口，可进入独立管理页面

> 请通过服务器地址使用客户端。登录页、聊天页和管理页已分离，直接打开本地 HTML 不再作为客户端入口。

### 开发验证

在 `server/` 中执行 `npm test`。测试覆盖 Luogu 公式、折叠框、表格合并、代码高亮、脚注隔离及安全清理，并在临时数据目录中验证账号权限、双客户端聊天、文件上传下载和房间管理，不修改现有账号或上传文件。新增测试覆盖好友审批、私聊成员隔离、重启持久化、旧数据迁移、前端资源的游客/普通用户/管理员访问限制，以及固定文案的本地回环 UDP 发送和失败处理。

`npm run test:browser` 提供真实 Chromium 检查（需另行安装 Playwright 并执行 `npx playwright install chromium`）。也可设置 `PLAYWRIGHT_MODULE_PATH` 和 `CHROMIUM_EXECUTABLE_PATH` 使用已安装环境。浏览器测试使用临时账号和数据，截图输出至系统临时目录下的 `betterlantalk-browser-artifacts`，可通过 `BROWSER_ARTIFACT_DIR` 指定目录。

### 管理功能

管理员登录后点击聊天页右上角「管理」：

- 📊 服务器状态
- ⚙️ 修改端口、对外 IP、单文件上限、上传目录总上限（保存到 `server/config.json`，端口重启生效，其余立即生效）
- 🏠 创建公开或私有房间；管理自己创建的房间，超级管理员可管理所有房间
- ✉️ 群聊中点击「邀请用户」，输入已注册用户名；该用户立即加入群聊，在线用户会收到通知，离线用户下次登录即可看到群聊
- 👥 账号管理：修改用户名、重置密码、删除普通用户；超级管理员可点击「设为管理员」或「取消管理员」，权限立即生效
- 🟢 在线用户、🔇 IP 禁言
- 📢 全服广播（发送至群聊，不插入双人私聊）
- 🔔 极域通知开关、UDP 端口、查看账号关联 IP 与测试弹窗

默认群自动加入所有账号且不可退出。新建的其他公开群只包含创建者，用户查找后主动加入；私有群由管理员邀请。群成员列表、历史消息、上传和下载都校验成员资格；超级管理员可管理群定义，但阅读内容仍需成员资格。移除成员会立即撤销访问并将正在查看该群的用户切回默认群。好友关系使用稳定账号 ID，改名不改变好友或私聊归属。

群聊和双人私聊历史保存在 `server/messages.json`，好友申请与关系保存在 `server/social.json`，重启后保留。升级时自动把已有公开群对旧用户的访问转换为明确成员，新注册用户仍只加入默认群；迁移前的账号与群数据会保存为 `*.pre-social.bak`，数据无法解析时停止启动，避免覆盖原文件。原版本仅在内存中的聊天记录无法在升级时恢复。

### 极域通知配置

1. 兼容的极域学生端须在目标电脑运行，服务器能够访问该电脑的 UDP 端口（默认 4705，可在管理页设置）。
2. 账号 IP 自动关联，无需极域设备绑定。新注册账号使用注册请求的实际 IP；旧普通账号沿用原注册 IP，原来没有 IP 的账号在首次成功登录时关联。超级管理员使用本次升级后首次成功登录的 IP。关联持久保存在 `users.json` 的 `boundIp`，升级前原文件备份为 `users.json.pre-ip.bak`。
3. 每个 IP 只能关联一个账号；账号不能从其他 IP 登录。登录、已有 token / Cookie、页面资源、文件和 Socket 会话均校验 IP；改名、改密码和重启不会改变关联。删除账号后该 IP 可供新账号使用。
4. IP 取服务器 TCP 连接的实际对端地址，不相信客户端的 `X-Forwarded-For` 或 `CF-Connecting-IP`。此模式应直接通过内网访问；如果多个设备经 NAT、Cloudflare Tunnel 或反向代理共用一个服务器可见的 IP，它们会被视为同一设备。改变设备地址后原账号仍受固定 IP 限制。
5. 开启「极域通知」后，在管理页对应账号点击「测试通知」。手动绑定入口已移除，旧手动设备名单不再作为通知目的地。发送完成仅表示 UDP 数据已交给网络，不能证明学生端收到或显示。
6. 当前会话在前台阅读时不发送极域提醒；其他会话、页面后台或浏览器关闭时使用账号关联 IP。非群成员和非私聊参与者不会收到该会话的提醒。
7. 每个目标 IP 共用 20 秒冷却，覆盖不同群聊、发送者、文件、图片、广播及测试通知；第一次发送即开始计时，期间的提醒直接忽略，不排队、不延长冷却、不影响聊天室内的消息送达。发送失败也占用冷却，避免连续重试。

文字和广播显示 `from 用户名: new message`，文件显示 `from 用户名: new flie`（按需求保留拼写），图片显示 `from 用户名: new picture`；不包含群名、正文或文件名。此方式无需 HTTPS 或外网推送服务，但依赖目标学生端版本与内网连通性。本地验证只向回环 UDP 接收器发送，不等同于真实学生端兼容性测试。弹窗协议结构参考用户提供的 [Jiyu_udp_attack](https://github.com/ht0Ruial/Jiyu_udp_attack)，本项目只实现通知弹窗。

### 前端资源权限

游客只收到登录与注册所需 HTML、JS、CSS；聊天页面和资源要求有效会话；管理页面及专属 JS、CSS 在每次请求时校验当前管理员身份。受保护资源使用 `Cache-Control: no-store`，编码路径、大小写别名和路径穿越不能绕过鉴权。所有消息、文件和管理 API 仍在服务器执行权限检查。

这是资源访问控制。已授权用户可以查看已下载的前端代码，公开 GitHub 仓库中的源码仍可阅读；浏览器执行 JavaScript 的能力不等于源码保密或消息端到端加密。

## 📁 项目结构

```
BetterLanTalk/
├── client/
│   ├── index.html / login.js / login.css # 登录与注册
│   ├── chat.html / chat.js / styles.css  # 登录后聊天
│   └── admin.html / admin.js / admin.css # 管理员专属资源
├── server/
│   ├── server.js       # 后端入口
│   ├── users.json      # 账号与登录令牌（自动生成）
│   ├── rooms.json      # 群聊、私聊与成员（自动生成）
│   ├── social.json     # 好友、申请及通知设备（自动生成）
│   ├── messages.json   # 聊天历史（自动生成）
│   ├── social.js       # 好友及会话 API
│   ├── jiyu.js         # 极域通知弹窗协议
│   ├── files.json      # 文件元数据（自动生成）
│   ├── uploads/        # 上传的文件（自动生成）
│   └── config.json     # 端口与文件限制配置（自动生成）
├── start.bat           # Windows 一键启动
├── start.sh            # Linux / macOS 一键启动
├── LICENSE
└── README.md
```

## 🔧 API接口（管理接口需 `Authorization: Bearer <token>`）

### 账号
```
POST /api/register     # 注册（同 IP 限一个账号）
POST /api/login        # 登录，返回 token
GET  /api/me           # 校验会话，返回稳定账号 ID 与当前用户
POST /api/logout       # 注销
GET  /api/accounts     # [管理] 账号列表
PUT  /api/users/:name  # [管理] 改名 / 重置密码
DELETE /api/users/:name# [管理] 删除账号
PUT /api/users/:name/role # [超级管理员] 设置 role: "admin" 或 "user"
GET  /api/config       # [管理] 查看端口与文件限制
PUT  /api/config       # [管理] 修改端口 / 单文件上限 / 总量上限
```

### 其他
```
GET  /api/health       POST /api/mute-ip    POST /api/unmute-ip
GET  /api/users        GET /api/rooms       POST /api/broadcast
POST /api/rooms        DELETE /api/rooms/:id  POST /api/rooms/:id/kick-users
GET /api/rooms?manage=1 # [管理] 可管理房间列表
POST /api/rooms/:id/invitations # [房间管理] 邀请，body: { "username": "已有账号" }
```

`GET /api/rooms` 需登录，只返回该账号可访问的房间；创建房间需管理员权限，body 包含 `roomId`、`roomName` 和 `isPublic`（布尔值，默认 `true`）。邀请、删除和移除成员仅允许仍具管理员身份的创建者或超级管理员操作。默认群不能移除成员；其他群可移除成员；删除在线房间需 `?force=true`，默认公共聊天室不能删除。

### 文件
```
GET  /api/limits       # 单文件/总量上限（公开，上传预校验）
POST /api/upload       # 上传文件（需登录；查询参数 room=房间ID）
GET  /api/files?room=  # 房间文件列表（需登录且有房间访问权限）
GET  /uploads/<存储名>  # 文件下载/预览（同上；浏览器使用 HttpOnly 会话 cookie，API 可使用 Bearer token）
```

### 好友、会话与极域（均需登录，极域设备管理需管理员）
```
GET  /api/people?q=用户名
GET  /api/social
POST /api/friend-requests             # body: { userId }
PUT  /api/friend-requests/:id          # action: accept/reject/withdraw
DELETE /api/friends/:userId
POST /api/direct-chats                # body: { userId }
GET  /api/public-rooms
POST /api/rooms/:roomId/join
POST /api/rooms/:roomId/leave
GET  /api/rooms/:roomId/members
DELETE /api/rooms/:roomId/members/:userId # [群管理员]
GET  /api/rooms/:roomId/messages?beforeId=消息ID
GET  /api/my-notification-devices
GET  /api/jiyu/devices                 # [管理] 只读账号关联 IP
POST /api/jiyu/test                    # [管理] body: { userId }，使用账号固定 IP
```
IP 校验同时适用于 Bearer token 和 HttpOnly Cookie，不能通过跨 IP 携带有效 token 绕过。配置 API 增加 `jiyuEnabled`（布尔值）及 `jiyuPort`（1–65535 的整数）。登录支持 HttpOnly 会话 Cookie，API 同时兼容 Bearer token。

## ⚠️ 注意事项

- 仅限内网环境使用
- 默认端口：3001（可在管理面板修改，重启生效）
- 每个账号仅可从其固定 IP 使用，同一 IP 仅可使用一个账号；删除账号可释放该 IP
- 文件默认单文件上限 5GB、`server/uploads/` 总量上限 20GB（管理面板可调）；超出总量时自动清理最早上传的文件，被清理的文件在界面中标记「已过期」
- 服务器重启后禁言列表会清空，但账号、端口配置与已上传文件会保留

## 📄 许可证

本项目基于原项目二次开发，采用与原项目一致的 [MIT License](LICENSE)。

原始版权：Copyright (c) 2025 [ChasonWang2012](https://github.com/ChasonWang2012)、LanTalk 项目及其贡献者。

## 🙏 致谢

- 感谢 [ChasonWang2012](https://github.com/ChasonWang2012) 开源的 [LanTalk](https://github.com/ChasonWang2012/LanTalk) 项目，为本项目提供了基础。
