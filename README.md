# 💬 BetterLanTalk 内网聊天室系统 v1.3.0

一个简单易用的内网聊天室系统，支持实时消息、好友私聊、群聊、用户账号体系、文件传输和管理员控制台。

> 本项目基于 [ChasonWang2012/LanTalk](https://github.com/ChasonWang2012/LanTalk)（MIT License）二次开发，在原项目基础上进行了功能增强与界面改造。原项目版权归原作者所有，详见 [LICENSE](LICENSE) 与下方「致谢」。

## ✨ 当前分支更新

- 默认浅色、纯 SVG 图标与圆角布局；聊天和联系人独立，支持深色／跟随系统／自定义强调色，适配 9:16 半屏窗口。
- Luogu Markdown 左右编辑预览，预览可关闭；保留高度调整、文件选择、拖放与 Ctrl+V 图片上传。默认 Enter 换行、Ctrl+Enter 发送，发送按钮旁的键盘图标可交换两者，并按账号保存。
- 本地 QQ 表情面板、搜索、最近使用及 `/jy` 等斜杠候选；消息支持引用、表情回应、复制和群精华。
- 支持 @单人；群主和群管理员可 @全体成员。每群可选择完全免打扰／仅重要消息／全部提醒，浏览器与极域遵循同一规则。完全免打扰保留灰色未读徽标及提及标记。
- 所有人类用户均可创建公开或私有群；独立群主／群管理员权限，支持好友邀请、问题自动校验、入群审核、公告、成员管理和群主转让。
- 联系人页管理好友与 Bot；好友申请和群邀请集中在联系人内，并提供红色待处理提示。头像、群昵称、私人群备注、置顶、个人记录清空及界面偏好持久保存。
- 管理员可解绑／换绑账号 IP，立即撤销相关会话；人类账号与 IP 保持一一对应，超级管理员首次成功登录绑定。
- 管理员可创建无绑定 IP 的 Bot，通过专用令牌 API 拉取消息、发消息、处理申请及执行已获授权的群管理；自动向人类账号发送一次好友申请。
- 全站管理与群管理独立；管理员不能读取未加入群组的消息。登录、聊天与管理源码按权限分开提供。
- 极域通知默认关闭，使用账号绑定 IP，显示 `from 用户名: new message/new file/new picture`；每台设备冷却 20 秒，期间直接忽略。
- 所有聊天资源、公式字体、代码高亮及 QQ 表情均本地提供；浏览器无需安装客户端，无需外网 CDN。

接口与示例：[API 文档](docs/API.md)、[Bot 示例](examples/bot.mjs)。本次版本为 `v1.3.0` 正式版。升级已有部署前，请阅读 [可信存储初始化与备份说明](docs/SECURITY-STORAGE.md)。

## 🛠️ 技术栈

**后端:** Node.js + Express + Socket.IO。密码哈希、token 生成均使用 Node 内置 `crypto` 模块；运行时数据存于 `server/*.json`。配置和账号的可信状态及随机密钥另存于数据目录之外的私有目录，检测到 JSON 副本篡改会自动恢复；部署、升级和备份见 [可信存储说明](docs/SECURITY-STORAGE.md)。

**前端:** 原生 HTML5/CSS3/JavaScript，白灰简洁界面。登录入口为 `client/index.html`，聊天与管理分别在 `client/chat.html` 和 `client/admin.html`，样式、Luogu 解析器、KaTeX 字体和 Prism 代码高亮均由服务器本地提供，聊天无需外网 CDN。

### Luogu Markdown

聊天与实时预览使用 [wudream813/luogu-markdown-editor](https://github.com/wudream813/luogu-markdown-editor) v1.40.3 的原版解析器，两端共用解析及 HTML 清理逻辑。聊天输入区默认左侧编辑、右侧实时预览，预览可以关闭；消息区直接显示渲染结果。工具栏仅保留表情、文件及预览图标，Markdown 直接编辑，常用格式快捷键仍可使用。

- 支持 `$...$` / `$$...$$` LaTeX 公式、嵌套折叠框、对齐、引言、引用链接、脚注和任务列表。
- 表格中 `<` 向左合并，`^` 向上合并；支持 Luogu 表格扩展。
- 代码块可指定 `cpp line-numbers lines=2,4-6`；常见竞赛语言提供本地高亮，并可复制代码。
- 支持 `![](bilibili:BV号)`；只有点击播放器才连接 Bilibili，外部图片或视频仍需客户端能访问其来源。
- 文件按钮、拖拽附件、Ctrl+V 图片上传保留；图片仍显示在消息中，文件仍出现在房间文件栏。
- 默认 Enter 换行、Ctrl+Enter（macOS 也可用 Command+Enter）发送；点击发送按钮旁的键盘图标可交换两者，刷新后保留选择。中文输入法确认候选文字不会误发送。每条文字消息最多 20,000 字符。
- 消息气泡按内容收紧，宽屏最大 520px；窄窗口中好友列表与成员/文件栏可展开、收起，开启预览时保持左右对照，关闭后编辑区铺满。
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

全新空数据目录首次启动会创建唯一初始超级管理员，并将账号副本写入 `server/users.json`：

```
admin / =Aa1357924680
```

⚠️ 请登录后尽快在管理面板中修改管理员密码。

升级已有安装时保留原有唯一超级管理员、密码和 IP 绑定；首次启用可信存储须显式执行 `--init-security`，不会自动提升其他账号。

### Windows 独立程序

Windows 10/11 x64 可使用 `BetterLanTalk-win-x64.exe`，无需安装 Node.js。将程序放在有写入权限的文件夹，双击启动，程序会打开浏览器并在控制台显示内网访问地址。关闭控制台或按 Ctrl+C 停止服务；其他电脑仍通过浏览器访问服务器地址。

程序已包含聊天页面、Markdown 编辑器、公式字体、代码高亮及 Socket.IO。账号、配置、消息和上传文件保存在 exe 旁自动生成的 `data/` 目录。升级时关闭旧程序、替换 exe 并保留 `data/` 及私有保护目录；已有数据首次升级到可信存储版本须执行一次 `--init-security`，详见 [初始化与备份说明](docs/SECURITY-STORAGE.md)。从源码版迁移时，将 `server/` 下的运行时 JSON、相关备份、`community.json`、`avatars/` 及 `uploads/` 复制到 `data/`。不要复制 `node_modules/`。需要指定其他存储位置时可设置 `LANTALK_DATA_DIR`；设置 `LANTALK_OPEN_BROWSER=0` 可禁用自动打开浏览器。

开发者重新构建需要 Node.js 22 或更新版本，在 `server/` 中执行：

```bash
npm ci
npm run bundle
```

产物为仓库根目录 `dist/BetterLanTalk-win-x64.exe`。首次构建需要联网下载打包工具的 Node.js 运行时，运行 exe 不需要联网下载依赖。打包采用维护中的 `@yao-pkg/pkg`，使用 Node.js 22 运行时；构建时只嵌入程序及静态资源，不包含现有账号、聊天记录、上传文件或端口配置。

`npm run bundle:linux` 可生成 Linux x64 独立程序，并使用 `npm run test:bundle` 验证启动、资源、消息和持久化。在 Windows 上也可用 `npm run test:bundle` 验证已构建的 exe。

### 客户端使用

1. 浏览器直接访问 `http://<服务器IP>:3001/`（无需下载任何 html）
2. 首次使用点击「注册」创建账号（每个 IP 只能注册一个）
3. 登录后加入默认聊天室；通过右侧「添加好友」发起申请，接受后建立私聊，通过左侧「查找公开群」加入其他群
4. 管理员账号右上角有「管理」入口，可进入独立管理页面

> 请通过服务器地址使用客户端。登录页、聊天页和管理页已分离，直接打开本地 HTML 不再作为客户端入口。

### 开发验证

在 `server/` 中执行 `npm test`。测试覆盖 Luogu 公式、折叠框、表格合并、代码高亮、脚注隔离及安全清理，并在临时数据目录中验证账号权限、双客户端聊天、文件上传下载和房间管理，不修改现有账号或上传文件。新增测试覆盖好友审批、私聊成员隔离、重启持久化、旧数据迁移、前端资源的游客/普通用户/管理员访问限制，以及固定文案的本地回环 UDP 发送和失败处理。

`npm run test:browser` 提供真实 Chromium 检查（需另行安装 Playwright 并执行 `npx playwright install chromium`）。也可设置 `PLAYWRIGHT_MODULE_PATH` 和 `CHROMIUM_EXECUTABLE_PATH` 使用已安装环境。浏览器测试使用临时账号和数据，截图默认输出至仓库旁的 `BetterLanTalk-verification/`，可通过 `BROWSER_ARTIFACT_DIR` 指定目录。

### 管理功能

管理员通过左下角工具箱进入「管理」，可调整服务器配置、账号、IP 绑定、Bot、全站角色、禁言、广播和极域通知；群治理列表只提供概况和强制解散。

普通群由独立群主和群管理员负责，入口在会话右上角。群主可编辑入群规则、任命管理员、转让及解散；群管理员可编辑公告、审核、管理普通成员及精华。所有成员可邀请自己的好友，邀请仍须通过问题或审核。

默认聊天室自动加入所有账号且不可退出。移除成员会立即撤销消息与附件访问；账号改名不改变好友、群成员或私聊归属。群和私聊历史、好友关系、审核与个人设置均持久保存。

### 极域通知配置

1. 兼容的极域学生端须在目标电脑运行，服务器能够访问该电脑的 UDP 端口（默认 4988，可在管理页设置；升级时保留已保存的端口配置）。
2. 账号 IP 自动关联，无需极域设备绑定。新注册账号使用注册请求的实际 IP；旧普通账号沿用原注册 IP，原来没有 IP 的账号在首次成功登录时关联。初始超级管理员在首次成功登录时绑定 IP，不沿用注册 IP；升级保留现有唯一超管，不再自动提升其他账号；密码错误不会绑定，已完成绑定的超级管理员在升级、重启后保留原 IP。关联持久保存在 `users.json` 的 `boundIp`，升级前原文件备份为 `users.json.pre-ip.bak`。
3. 每个 IP 只能关联一个账号；账号不能从其他 IP 登录。登录、已有 token / Cookie、页面资源、文件和 Socket 会话均校验 IP；改名、改密码和重启不会改变关联。管理员可解绑或换绑，立即撤销该账号会话；删除账号也会释放 IP。
4. IP 取服务器 TCP 连接的实际对端地址，不相信客户端的 `X-Forwarded-For` 或 `CF-Connecting-IP`。此模式应直接通过内网访问；如果多个设备经 NAT、Cloudflare Tunnel 或反向代理共用一个服务器可见的 IP，它们会被视为同一设备。改变设备地址后原账号仍受固定 IP 限制。
5. 开启「极域通知」后，在管理页对应账号点击「测试通知」。手动绑定入口已移除，旧手动设备名单不再作为通知目的地。发送完成仅表示 UDP 数据已交给网络，不能证明学生端收到或显示。
6. 群通知档位同时控制浏览器与极域，完全免打扰连 @ 也不提醒。当前会话在前台阅读时不发送极域提醒；其他会话、页面后台或浏览器关闭时使用账号关联 IP。非群成员和非私聊参与者不会收到该会话的提醒。
7. 每个目标 IP 共用 20 秒冷却，覆盖不同群聊、发送者、文件、图片、广播及测试通知；第一次发送即开始计时，期间的提醒直接忽略，不排队、不延长冷却、不影响聊天室内的消息送达。发送失败也占用冷却，避免连续重试。

文字和广播显示 `from 用户名: new message`，文件显示 `from 用户名: new file`，图片显示 `from 用户名: new picture`；不包含群名、正文或文件名。此方式无需 HTTPS 或外网推送服务，但依赖目标学生端版本与内网连通性。本地验证只向回环 UDP 接收器发送，不等同于真实学生端兼容性测试。弹窗协议结构参考用户提供的 [Jiyu_udp_attack](https://github.com/ht0Ruial/Jiyu_udp_attack)，本项目只实现通知弹窗。

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
│   ├── social.json     # 好友与好友申请（自动生成）
│   ├── community.js    # 群权限、消息、Bot 与个人设置
│   ├── community.json  # 设置、审核、邀请、审计与 Bot 更新（自动生成）
│   ├── avatars/        # 持久头像（自动生成）
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

## API 与 Bot

好友申请与群邀请在「联系人」的「新朋友」「群邀请」中处理，红色数量只统计收到的待处理事项；审核中的邀请显示「待审核」。

完整参数、权限、错误码、Socket.IO 事件和旧接口停用说明见 **[API 文档](docs/API.md)**。新群组使用 `/api/groups`；会话记录继续使用 `/api/rooms/:roomId/messages`。Bot 使用 `/api/bot/v1` 和独立令牌，调用示例见 [examples/bot.mjs](examples/bot.mjs)。

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

## 升级与数据

首次运行新群组版本时，旧自建群保留归档数据并从会话／公开搜索列表移除，默认聊天室、账号、好友及私聊继续保留；不把旧群自动迁入新群系统。升级前可完整备份原数据目录，回退旧程序时恢复这份备份。

新增 `community.json` 保存群个人设置、邀请、审核、IP 审计和 Bot 更新队列；`avatars/` 保存头像。这些与账号、群定义、消息及附件一起备份；启用可信存储后还必须备份对应私有保护目录，详见 [备份与迁移](docs/SECURITY-STORAGE.md)。独立程序使用 exe 旁的 `data/`，或 `LANTALK_DATA_DIR` 指定目录。

QQ 表情资源固定自 [koishijs/QFace](https://github.com/koishijs/QFace)，来源和版权说明在 `client/vendor/qq/NOTICE.md`。上游代码的 MIT 许可不等同于腾讯表情素材许可，保留上游素材使用说明。

本地验证：`npm --prefix server test`；安装 Playwright 并配置 Chromium 后运行 `npm --prefix server run test:browser`。Linux 构建运行 `npm --prefix server run bundle:linux`，再运行 `npm --prefix server run test:bundle`；Windows 构建运行 `bundle`，原生验证仍需 Windows 环境。
