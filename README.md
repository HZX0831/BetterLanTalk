# 💬 BetterLanTalk 内网聊天室系统 v1.0.1

一个简单易用的内网聊天室系统，支持实时消息、多房间聊天、用户账号体系、文件传输和管理员控制台。

> 本项目基于 [ChasonWang2012/LanTalk](https://github.com/ChasonWang2012/LanTalk)（MIT License）二次开发，在原项目基础上进行了功能增强与界面改造。原项目版权归原作者所有，详见 [LICENSE](LICENSE) 与下方「致谢」。

## ✨ 功能特性

### 原项目已有
- 💬 **实时聊天** - 基于 WebSocket 的即时消息
- 🏠 **多房间支持** - 创建和加入不同聊天室
- 📝 **支持 Markdown** - 完整的 Markdown 语法支持
- 🔇 **IP 禁言** - 管理员禁言违规用户
- 📱 **响应式设计** - 适配电脑和手机

### 本版本新增 / 增强
- 👥 **账号系统** - 用户名 + 密码注册 / 登录，密码使用 Node 内置 `crypto.scrypt` 加盐哈希存储；每个 IP 限注册一个账号
- 🔐 **登录持久化** - 「记住我」后刷新页面自动登录，token 有效期 7 天
- 🛡️ **管理面板融入主界面** - 管理员登录后在聊天界面内切换「管理」视图，无需单独打开页面；支持修改端口、单文件大小与存储总量上限
- 👥 **账号管理** - 管理员可修改任意用户的用户名、重置密码、删除账号
- 📎 **文件传输** - 图片直接显示在消息中（支持 Ctrl+V 粘贴上传），其他文件显示在右侧「房间文件」栏；单文件额度与存储总量可在管理面板调整，超出总量自动清理最早上传的文件（界面标记「已过期」）
- 🔔 **浏览器通知** - 页面在后台时收到新消息弹出系统通知，点击可聚焦窗口
- 🌐 **免下载客户端** - 浏览器直接访问 `http://<服务器IP>:端口/` 即可使用，Socket.IO 客户端由服务器本地提供，无需外网 CDN
- 💻 **一键启动脚本** - `start.bat`（Windows）/ `start.sh`（Linux / macOS）
- ✨ **体验优化** - 用户进出改为右上角限时提示（不再刷屏）；页面刷新不再误报「离开 / 进入」；文件侧栏折叠；管理员广播等系统消息使用统一大消息框

## 🛠️ 技术栈

**后端:** Node.js + Express + Socket.IO。密码哈希、token 生成均使用 Node 内置 `crypto` 模块，零额外依赖；运行时数据（账号、登录令牌、文件元数据、端口配置）存于 `server/*.json`。

**前端:** 原生 HTML5/CSS3/JavaScript，单文件客户端（`client/index.html`），Socket.IO 客户端由服务器本地提供。

## 🚀 快速开始

### 方式一：一键启动

- Windows：双击 `start.bat`
- Linux / macOS：`chmod +x start.sh && ./start.sh`

脚本会自动检测 Node.js、首次运行时安装依赖并启动服务器，随后自动用**本机内网 IP** 打开浏览器（如 `http://192.168.1.10:3001/`）。若本机有虚拟网卡（VPN / 代理 TUN 等）导致自动识别不准，可在管理面板的「服务器设置」里手动指定「对外 IP」。

### 方式二：手动启动

```bash
cd server
npm install
node server.js
```

启动后控制台会打印访问地址，默认 `http://<服务器IP>:3001/`。

首次启动会在 `server/users.json` 中自动创建默认管理员：

```
admin / admin123
```

⚠️ 请登录后尽快在管理面板中修改管理员密码。

### 客户端使用

1. 浏览器直接访问 `http://<服务器IP>:3001/`（无需下载任何 html）
2. 首次使用点击「注册」创建账号（每个 IP 只能注册一个）
3. 登录后即可聊天；管理员账号会多出「🛡️ 管理」视图

> 也可以直接用浏览器打开 `client/index.html`（需要手动输入服务器地址，端口需完整填写，如 `http://192.168.2.10:3001`）。

### 管理功能

管理员登录后点击主界面右上角「🛡️ 管理」：

- 📊 服务器状态
- ⚙️ 修改端口、对外 IP、单文件上限、上传目录总上限（保存到 `server/config.json`，端口重启生效，其余立即生效）
- 🏠 创建 / 删除房间、踢出用户
- 👥 账号管理：修改用户名、重置密码、删除账号
- 🟢 在线用户、🔇 IP 禁言
- 📢 全服广播

## 📁 项目结构

```
BetterLanTalk/
├── client/index.html   # 客户端（聊天 + 管理面板一体）
├── server/
│   ├── server.js       # 后端入口
│   ├── users.json      # 账号与登录令牌（自动生成）
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
GET  /api/config       # [管理] 查看端口与文件限制
PUT  /api/config       # [管理] 修改端口 / 单文件上限 / 总量上限
```

### 其他
```
GET  /api/health       POST /api/mute-ip    POST /api/unmute-ip
GET  /api/users        GET /api/rooms       POST /api/broadcast
POST /api/rooms        DELETE /api/rooms/:id  POST /api/rooms/:id/kick-users
```

### 文件
```
GET  /api/limits       # 单文件/总量上限（公开，上传预校验）
POST /api/upload       # 上传文件（需登录；查询参数 room=房间ID）
GET  /api/files?room=  # 房间文件列表（需登录）
GET  /uploads/<存储名>  # 文件下载/预览
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
