# 💬 BetterLanTalk 内网聊天室系统 v1.1.0

一个简单易用的内网聊天室系统，支持实时消息、多房间聊天、用户账号体系、文件传输和管理员控制台。

> 本项目基于 [ChasonWang2012/LanTalk](https://github.com/ChasonWang2012/LanTalk)（MIT License）二次开发，在原项目基础上进行了功能增强与界面改造。原项目版权归原作者所有，详见 [LICENSE](LICENSE) 与下方「致谢」。

## ✨ 功能特性

### 原项目已有
- 💬 **实时聊天** - 基于 WebSocket 的即时消息
- 🏠 **多房间支持** - 创建和加入不同聊天室
- 📝 **支持 Markdown** - 完整的 Markdown 语法支持
- 🔇 **IP 禁言** - 管理员禁言违规用户
- 💻 **桌面界面** - 左侧源码、右侧实时预览，消息区直接渲染

### 本版本新增 / 增强
- 👥 **账号系统** - 用户名 + 密码注册 / 登录，密码使用 Node 内置 `crypto.scrypt` 加盐哈希存储；每个 IP 限注册一个账号
- 🔐 **登录持久化** - 「记住我」后刷新页面自动登录，token 有效期 7 天
- 🛡️ **管理面板融入主界面** - 管理员登录后在聊天界面内切换「管理」视图，无需单独打开页面；支持修改端口、单文件大小与存储总量上限
- 👥 **账号管理** - 初始账号为超级管理员，可设置或取消管理员；普通管理员可管理普通用户账号，不能修改其他管理员或超级管理员
- 🏠 **房间权限** - 仅管理员可创建房间；公开房间自动加入所有用户，私有房间仅创建者和受邀账号可访问，房间定义与邀请名单持久保存
- 📎 **文件传输** - 图片直接显示在消息中（支持 Ctrl+V 粘贴上传），其他文件显示在右侧「房间文件」栏；单文件额度与存储总量可在管理面板调整，超出总量自动清理最早上传的文件（界面标记「已过期」）
- 🔔 **浏览器通知** - 页面在后台时收到新消息弹出系统通知，点击可聚焦窗口
- 🌐 **免下载客户端** - 浏览器直接访问 `http://<服务器IP>:端口/` 即可使用，Socket.IO 客户端由服务器本地提供，无需外网 CDN
- 💻 **一键启动脚本** - `start.bat`（Windows）/ `start.sh`（Linux / macOS）
- ✨ **体验优化** - 用户进出改为右上角限时提示（不再刷屏）；页面刷新不再误报「离开 / 进入」；文件侧栏折叠；管理员广播等系统消息使用统一大消息框

## 🛠️ 技术栈

**后端:** Node.js + Express + Socket.IO。密码哈希、token 生成均使用 Node 内置 `crypto` 模块；运行时数据（账号、登录令牌、房间与邀请名单、文件元数据、端口配置）存于 `server/*.json`。

**前端:** 原生 HTML5/CSS3/JavaScript，白灰简洁界面。客户端入口为 `client/index.html`，样式、Luogu 解析器、KaTeX 字体和 Prism 代码高亮均由服务器本地提供，聊天无需外网 CDN。

### Luogu Markdown

聊天与实时预览使用 [wudream813/luogu-markdown-editor](https://github.com/wudream813/luogu-markdown-editor) v1.40.3 的原版解析器，两端共用解析及 HTML 清理逻辑。聊天输入区提供粗体、斜体、公式、代码、表格和折叠框插入按钮，以及左侧源码、右侧实时预览的桌面双栏编辑区；消息区直接显示渲染结果。工具栏复用上游图标，保留常用 Markdown 插入与撤销/重做，不提供排版修复、模板、导出或工作区功能。

- 支持 `$...$` / `$$...$$` LaTeX 公式、嵌套折叠框、对齐、引言、引用链接、脚注和任务列表。
- 表格中 `<` 向左合并，`^` 向上合并；支持 Luogu 表格扩展。
- 代码块可指定 `cpp line-numbers lines=2,4-6`；常见竞赛语言提供本地高亮，并可复制代码。
- 支持 `![](bilibili:BV号)`；只有点击播放器才连接 Bilibili，外部图片或视频仍需客户端能访问其来源。
- 文件按钮、拖拽附件、Ctrl+V 图片上传保留；图片仍显示在消息中，文件仍出现在房间文件栏。
- Enter 发送，Shift+Enter 换行；中文输入法确认候选文字不会误发送。每条文字消息最多 20,000 字符。

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
3. 登录后即可聊天；管理员账号会多出「🛡️ 管理」视图

> 也可以在完整仓库安装依赖后直接用浏览器打开 `client/index.html`（需要手动输入服务器地址，端口需完整填写，如 `http://192.168.2.10:3001`）。请保留 `client/` 和 `server/node_modules/`；推荐通过服务器访问，单独复制 HTML 不包含公式字体与渲染脚本。

### 开发验证

在 `server/` 中执行 `npm test`。测试覆盖 Luogu 公式、折叠框、表格合并、代码高亮、脚注隔离及安全清理，并在临时数据目录中验证账号权限、双客户端聊天、文件上传下载和房间管理，不修改现有账号或上传文件。

### 管理功能

管理员登录后点击主界面右上角「🛡️ 管理」：

- 📊 服务器状态
- ⚙️ 修改端口、对外 IP、单文件上限、上传目录总上限（保存到 `server/config.json`，端口重启生效，其余立即生效）
- 🏠 创建公开或私有房间；管理自己创建的房间，超级管理员可管理所有房间
- ✉️ 私有房间中点击「邀请用户」，输入已注册用户名；该用户立即获得访问权限，在线用户会收到通知，离线用户下次登录即可看到房间
- 👥 账号管理：修改用户名、重置密码、删除普通用户；超级管理员可点击「设为管理员」或「取消管理员」，权限立即生效
- 🟢 在线用户、🔇 IP 禁言
- 📢 全服广播

公开房间对现有和以后注册的账号自动开放，无需手动加入。私有房间的列表、聊天记录、消息、上传和下载均校验成员资格；超级管理员可管理私有房间，但阅读内容同样需要邀请。私有房间的「移除受邀成员」会撤销全部邀请，保留创建者；被移除用户如果正在查看该房间，会自动返回公共聊天室。

房间与邀请名单保存在 `server/rooms.json`，重启后保留；聊天消息仍只存于内存，重启后清空。

## 📁 项目结构

```
BetterLanTalk/
├── client/index.html   # 客户端（聊天 + 管理面板一体）
├── server/
│   ├── server.js       # 后端入口
│   ├── users.json      # 账号与登录令牌（自动生成）
│   ├── rooms.json      # 房间定义与邀请名单（自动生成）
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
GET  /api/me           # 校验 token，返回当前用户
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

`GET /api/rooms` 需登录，只返回该账号可访问的房间；创建房间需管理员权限，body 包含 `roomId`、`roomName` 和 `isPublic`（布尔值，默认 `true`）。邀请、删除和移除成员仅允许仍具管理员身份的创建者或超级管理员操作。公开房间不能移除成员；删除在线房间需 `?force=true`，默认公共聊天室不能删除。

### 文件
```
GET  /api/limits       # 单文件/总量上限（公开，上传预校验）
POST /api/upload       # 上传文件（需登录；查询参数 room=房间ID）
GET  /api/files?room=  # 房间文件列表（需登录且有房间访问权限）
GET  /uploads/<存储名>  # 文件下载/预览（同上；浏览器使用 HttpOnly 会话 cookie，API 可使用 Bearer token）
```

## ⚠️ 注意事项

- 仅限内网环境使用
- 默认端口：3001（可在管理面板修改，重启生效）
- 每个 IP 仅能注册一个账号；删除账号可解绑该 IP
- 文件默认单文件上限 5GB、`server/uploads/` 总量上限 20GB（管理面板可调）；超出总量时自动清理最早上传的文件，被清理的文件在界面中标记「已过期」
- 服务器重启后禁言列表会清空，但账号、端口配置与已上传文件会保留

## 📄 许可证

本项目基于原项目二次开发，采用与原项目一致的 [MIT License](LICENSE)。

原始版权：Copyright (c) 2025 [ChasonWang2012](https://github.com/ChasonWang2012)、LanTalk 项目及其贡献者。

## 🙏 致谢

- 感谢 [ChasonWang2012](https://github.com/ChasonWang2012) 开源的 [LanTalk](https://github.com/ChasonWang2012/LanTalk) 项目，为本项目提供了基础。
