# BetterLanTalk v1.3.0

面向内网的聊天与文件传输工具，支持好友私聊、群聊、Luogu Markdown、Bot 和管理员控制台。服务器部署一次，其他设备通过桌面浏览器访问，支持 9:16 竖向半屏窗口。

基于 [ChasonWang2012/LanTalk](https://github.com/ChasonWang2012/LanTalk) 二次开发，保留原项目 MIT 许可证与版权声明。

## 本次重新发行的变化

- 功能分支合入 `main`，`v1.3.0` 标签与发行源码同步到主分支。
- 彻底移除配置和账号的防篡改、可信快照、自动恢复与安全初始化；`config.json` 和 `users.json` 均按普通 JSON 读写。
- 新增 `superadminIP` 配置，指定超级管理员的设备 IP；留空时沿用首次成功登录绑定规则。
- 不再构建或提供 Windows `.exe` 发行包。Windows 使用 Node.js 启动源码，Linux x64 仍提供独立程序。

[下载 v1.3.0](https://github.com/HZX0831/BetterLanTalk/releases/tag/v1.3.0) · [API 文档](docs/API.md) · [数据与迁移](docs/DATA-MIGRATION.md) · [验证记录](docs/VERIFICATION.md)

## 功能

- 默认浅色，支持深色／跟随系统、自定义强调色、SVG 图标与圆角布局；聊天和联系人独立，右侧展示群公告与成员。
- 好友申请和群邀请在联系人内处理，导航与入口显示红色待处理数，审核中的邀请显示等待状态。支持好友私聊、Bot 好友、自定义头像、群昵称、个人备注与置顶。
- Luogu Markdown 左右编辑／实时预览，预览可关闭、编辑区高度可调。消息直接渲染，支持公式、代码高亮、折叠框、脚注和表格扩展。
- 本地 QQ 表情、搜索、最近使用及 `/jy` 等斜杠候选；消息支持引用、复制、表情回应和群精华。右键菜单按消息／成员提供操作，输入区保留浏览器原生菜单。
- 默认 Enter 换行、Ctrl+Enter 发送；发送按钮旁的键盘图标可交换两者，按账号保存。macOS 同时支持 Command+Enter，输入法及表情／@ 候选确认不会误发送。
- 文件选择、外部拖放、Ctrl+V 图片上传及聊天文件列表；聊天内图片拖动不会重复上传或发送。
- 人类账号可创建公开／私有群，支持好友邀请、问题校验、入群审核、群主转让和群管理员；默认公共聊天室自动加入所有账号。
- @单人及受群角色限制的 @全体；每群支持完全免打扰、仅重要消息、全部提醒，免打扰消息保留灰色未读数和提及标记。
- 全站管理员可管理账号、普通用户 IP、Bot、禁言、广播和极域通知；全站权限与群管理独立，不能读取未加入群的消息。
- 页面、公式字体、代码高亮与表情本地提供，无需外网 CDN，浏览器无需安装客户端。

## 部署

### Windows、Linux、macOS：源码运行

安装 [Node.js 22 或更新的受支持版本](https://nodejs.org/)，下载解压仓库，或使用 Git：

```bash
git clone https://github.com/HZX0831/BetterLanTalk.git
cd BetterLanTalk
npm --prefix server ci --omit=dev
node server/server.js
```

默认监听 `0.0.0.0:3001`。服务器与其他内网电脑访问控制台显示的 `http://服务器IP:3001`，防火墙需要允许该端口。

也可使用一键脚本，首次运行自动安装依赖：

- Windows：`start.bat`。
- Linux／macOS：`bash start.sh`。

脚本默认打开浏览器，`LANTALK_NO_BROWSER=1` 可关闭。首次安装依赖需要联网；安装后的本地页面不依赖外网，但消息中的外部图片、Bilibili 视频仍需客户端能访问对应来源。

### Linux x64：独立程序

下载 `BetterLanTalk-linux-x64` 与 `SHA256SUMS.txt`，放入同一目录：

```bash
sha256sum -c SHA256SUMS.txt
chmod +x BetterLanTalk-linux-x64
./BetterLanTalk-linux-x64
```

此方式无需安装 Node.js，默认在程序旁的 `data/` 保存数据。源码默认在 `server/` 保存运行数据；两者均可用 `LANTALK_DATA_DIR` 指定其他数据目录。

### 初始账号

全新部署创建唯一超级管理员：

```text
用户名：admin
密码：=Aa1357924680
```

登录后请修改默认密码。普通用户注册后只自动加入默认聊天室；添加好友后才能私聊，其他群需主动加入或接受邀请。

## 配置文件与超级管理员 IP

配置文件为数据目录内的 `config.json`，首次启动会生成默认值。**编辑前停服，保存后重启**；它不再从可信源备份或恢复。损坏或无效配置会报错，不使用旧快照覆盖文件。

```json
{
  "port": 3001,
  "maxFileMB": 5120,
  "maxUploadsMB": 20480,
  "serverIP": "",
  "jiyuEnabled": false,
  "jiyuPort": 4988,
  "superadminIP": "192.168.1.10"
}
```

首次启动前也可只创建 `{"superadminIP":"192.168.1.10"}`，其余使用默认值。示例 IP 应换成超管实际使用的设备 IP，不要固定照抄服务器地址。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `port` | `3001` | HTTP／Socket.IO 监听端口 |
| `maxFileMB` | `5120` | 单文件上传上限，单位 MB |
| `maxUploadsMB` | `20480` | 上传总量上限，须不小于单文件上限 |
| `serverIP` | `""` | 对外展示和打开浏览器的 IPv4 地址，空值自动检测；不决定超管身份绑定 |
| `jiyuEnabled` | `false` | 极域通知开关 |
| `jiyuPort` | `4988` | 学生端 UDP 端口 |
| `superadminIP` | `""` | 超管设备 IP；空值保留已有绑定，尚未绑定时首次成功密码登录绑定 |

指定 `superadminIP` 后，启动时将原有唯一超管绑定到该 IP，保留 ID、用户名与密码。更换该字段会撤销超管旧会话，必须重新登录。IP 若被其他账号占用，服务拒绝启动：先由管理员解除冲突，再编辑重启。管理面板／API 不能绕过此字段为超管解绑或换绑。

清空该字段不会清除已保存的绑定。需要恢复首次登录绑定时，可清空字段并重启，再在管理面板解绑超管。普通用户仍与 IP 一一对应，管理员可在面板换绑／解绑；Bot 不绑定 IP。

IP 取 TCP 连接实际对端地址，不信任 `X-Forwarded-For` 或 `CF-Connecting-IP`。推荐直接内网访问；NAT、反向代理或 Cloudflare Tunnel 可能令多台设备表现为一个 IP，不能直接套用该绑定方式。

面板仍可修改端口、上传限制和极域设置：端口重启生效，其余按面板提示生效。配置文件不保存角色，添加 `admin`／`superadmin` 字段不会授予权限。

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `LANTALK_DATA_DIR` | 运行数据目录，建议使用绝对路径 |
| `PORT` | 本次进程监听端口覆盖值，不改写配置 |
| `LANTALK_OPEN_BROWSER=1` | 自动打开浏览器；`0` 禁用 |
| `LANTALK_NO_BROWSER=1` | 禁止脚本／独立程序自动打开浏览器 |

## 账号、升级与备份

账号直接保存在 `users.json`，密码仍使用带盐 scrypt 哈希，会话按普通 JSON 持久保存。服务启动时读取文件，运行中不监控、签名、备份或恢复账号；手工改动需停止服务后编辑、重启生效。平时改密码、角色和绑定仍建议使用管理面板，以同步好友、群组与会话状态。

全新数据创建唯一初始超管，角色接口只允许授予 `admin`／`user`，不会额外创建超管。账号文件格式要求恰好一名 `superadmin`；零个／多个或 JSON 损坏会明确报错，不自动提升或重建账号。缺失既有账号数据时请自行恢复备份。

1. 停止旧服务，备份完整数据目录，包括账号、群组、好友、消息、附件、头像和 `community.json`。
2. 更新源码并执行 `npm --prefix server ci --omit=dev`，或替换 Linux 程序；保持原数据目录。
3. 原 v1.3.0 数据可直接使用：以现有 `users.json` 为准，不再读取旧私有目录、密钥或可信快照，旧安全标记也不会阻止启动，无需安全初始化。
4. 若很早的旧版只有 `admin` 角色，停服备份后确认初始管理员，将且仅将该账号的 `role` 设为 `superadmin`，再启动；程序不会自动代选。
5. 如需固定超管设备，停服修改 `superadminIP`，启动后验证登录。

从旧 Windows exe 迁移到源码：保留原 `data/`，设置 `LANTALK_DATA_DIR` 为它的绝对路径，再启动源码。无需转移旧私有保护目录。确认账号、群组和历史完整后，旧密钥、快照和安全标记可自行归档或清理，本程序不会主动删除这些历史文件。

旧群系统升级时，旧自建群保留归档数据并移出会话／搜索列表，默认聊天室、账号、好友、私聊和附件保留，不自动迁入新群系统。旧建房／直接加人接口停用，改用 `/api/groups`。

回退旧版本前请恢复该版本的完整备份；如果旧版本依赖私有快照，需同时保留对应旧备份。数据目录包含账号哈希、会话和聊天记录，应限制访问。详见 [数据迁移说明](docs/DATA-MIGRATION.md)。

## 使用与管理

- 左侧切换聊天与联系人；半屏点击联系人图标展开列表，选择后收起。左下工具箱提供版本、主题、通知、退出及管理入口。
- 群主／群管在右上角管理公告、成员、邀请、审核、精华与搜索。全站管理员不能读取未加入群的消息；默认聊天室由全站管理员管理。
- “仅重要消息”提醒群主／群管发言及 @自己／@全体；“完全免打扰”连 @ 也不触发浏览器或极域提醒，但保留未读数。
- 极域默认关闭，目标为账号绑定 IP，文案是 `from 用户名: new message/new file/new picture`。每台设备共用 20 秒冷却，期间忽略提醒；UDP 发出不代表学生端一定显示。
- 内网 HTTP 可使用未读标记；系统通知通常需要 HTTPS 或 localhost。网页关闭后的浏览器 Web Push 不在当前实现中，极域通知由服务器独立发送。
- 上传超总量会清理较早文件，附件标记过期。删除好友后历史可读、停止发送；退群或被移出后撤销该群记录与文件访问。
- 登录与管理资源按权限提供，接口和 Socket 继续鉴权；不属于端到端加密，也不能阻止已授权用户查看下载到本机的前端源码。

## API 与 Bot

人类使用 Cookie 或 Bearer 令牌，Bot 使用独立令牌及 `/api/bot/v1`。管理员可创建／停用 Bot、重置令牌，完整令牌仅在创建或重置时显示；Bot 自动向现有及后续人类账号发送一次好友申请。

Bot 支持消息、附件、邀请、长轮询及获授权后的群管理，不能成为全站管理员、创建群或担任群主。接口不是 Telegram 协议兼容实现。

[完整 HTTP／Socket.IO 文档](docs/API.md) · [Bot 示例](examples/bot.mjs)

## 开发与验证

```bash
npm --prefix server ci
npm --prefix server test
```

浏览器回归还需 Playwright 和 Chromium，在 `server/` 中安装并运行：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

可用 `PLAYWRIGHT_MODULE_PATH`／`CHROMIUM_EXECUTABLE_PATH` 指定已有安装。Linux 构建与独立程序检查：

```bash
npm --prefix server run bundle:linux
npm --prefix server run test:bundle
```

产物在 `dist/BetterLanTalk-linux-x64`。首次构建需联网获取运行时，可用 `PKG_CACHE_PATH` 指定缓存。CI 在 Windows、Linux 验证源码，只在 Linux 构建／检查独立程序，发布 Linux 文件及校验值。

## 数据与技术栈

后端为 Node.js、Express、Socket.IO，前端为原生 HTML／CSS／JavaScript。

| 数据 | 内容 |
| --- | --- |
| `config.json` | 可编辑配置，重启读取 |
| `users.json` | 账号、密码哈希、绑定 IP、角色与会话 |
| `rooms.json`、`social.json` | 群组／私聊、成员、好友与申请 |
| `messages.json`、`files.json`、`uploads/` | 消息、附件元数据与文件 |
| `community.json`、`avatars/` | 设置、邀请、审核、审计、Bot 更新与头像 |

禁言名单目前保存在内存，重启清空；其他上述数据持久保存。面向可信内网，不包含公网托管、自动 TLS 或反向代理身份适配。

## 许可证与来源

代码沿用 [MIT License](LICENSE)，保留 ChasonWang2012、LanTalk 项目及贡献者版权声明。

- Markdown 来自 [wudream813/luogu-markdown-editor](https://github.com/wudream813/luogu-markdown-editor)，固定 v1.40.3，原版解析器、许可和版本记录保存在 `client/vendor/luogu-markdown-editor/`。
- QQ 表情固定来自 [koishijs/QFace](https://github.com/koishijs/QFace)，见 [NOTICE](client/vendor/qq/NOTICE.md)。代码 MIT 许可不替代腾讯表情素材使用条件。
- 极域协议参考 [ht0Ruial/Jiyu_udp_attack](https://github.com/ht0Ruial/Jiyu_udp_attack)。
