# 本地更新与验证记录

日期：2026-10-23。分支：`feat/jiyu-popup-notification`。本记录对应 `v1.3.0` 正式版的本地发布验证；该标签的 Windows／Linux 原生 CI 结果见 [Release](https://github.com/HZX0831/BetterLanTalk/releases/tag/v1.3.0) 和对应 GitHub Actions。以下表格记录本地环境结果。

## 完成内容

- 登录、聊天、管理页统一屏蔽普通区域的浏览器右键菜单，保留文本输入区原生菜单，以及消息、成员的自定义菜单。
- 配置与账号使用私有目录中的随机密钥及 HMAC-SHA256 可信状态；启动时、保存前和运行期间恢复被改写、删除、损坏或回退的普通 JSON 副本。
- 超管固定 ID 且始终唯一；移除自动提升，保护原密码、IP、Bot 凭据和会话。可信状态异常停止服务，首次升级需显式初始化；原子保存、私有目录权限和单实例锁。
- 联系人新增新朋友、群邀请，导航与入口显示红色待处理数量（99+）；群邀请支持拒绝和撤回审核。待审核不计红标，聊天免打扰继续使用灰色未读数。
- 发送按钮旁新增键盘图标，可交换 Enter 和 Ctrl+Enter 的发送／换行行为；按账号保存，兼容 Command、Shift+Enter、中文输入法和表情／@ 候选，切换保留草稿。
- 半屏联系人图标可展开列表，选择联系人或申请页面后收起；更新 [API 文档](API.md)、[可信存储与备份说明](SECURITY-STORAGE.md)。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm --prefix server test` | 66 项通过，0 失败、0 跳过 |
| `npm --prefix server run test:browser` | Chromium 实际操作检查通过，无页面脚本错误 |
| `npm --prefix server run bundle:linux` | Linux x64 构建成功 |
| `npm --prefix server run test:bundle` | Linux 独立程序实际运行检查通过，包含篡改恢复 |
| `npm --prefix server run bundle` | Windows x64 exe 交叉构建成功，PE x64 格式确认 |
| Windows 原生运行／ACL／恢复 | 当前 Linux 环境未执行，仍需 Windows 环境验证 |
| `git diff --check` | 通过 |

环境：Linux x64、Node.js 24.19.0、Playwright、Chromium。打包运行时为 Node.js 22。此环境构建时设置 `PKG_CACHE_PATH=/workspace/.cache/pkg`，浏览器使用 `PLAYWRIGHT_MODULE_PATH` 和 `CHROMIUM_EXECUTABLE_PATH` 指向已安装组件。

自动化测试全部使用隔离临时数据目录及私有目录。恢复场景涵盖角色提权、第二个超管、密码哈希、IP、伪造令牌、损坏 JSON、文件删除、旧副本回退、合法修改后重启、错误／缺失密钥、可信快照损坏、运行中停止服务、初始化约束及并发实例。另覆盖群邀请接收人权限、重复拒绝、审核状态、撤回和重启持久化。

浏览器验证三个页面的右键行为、输入区例外、自定义菜单及关闭，以及实际 Ctrl+V 图片、拖动防重复、引用／回应、发送快捷键切换、刷新持久化、Enter／Ctrl+Enter／输入法防误发、Markdown 渲染和高度调整。联系人验证真实双客户端申请、红标、查看不清除、接受／拒绝／撤回、审核等待、刷新与断线重连、Bot 申请；补充 99+ 和发出申请不计红标的界面测试。检查浅色、深色和 540×960 半屏，保留灰色免打扰未读及 @ 标记。

Linux 独立程序在空工作目录及不含 Node.js 的 PATH 下运行，检查嵌入资源、鉴权、消息、表情、上传下载、群组、Bot、头像、设置和重启持久化；改写账号与配置后重启，确认恢复。另验证自定义数据目录和独立私有目录。

## 本地产物

- `dist/BetterLanTalk-win-x64.exe`、`dist/BetterLanTalk-linux-x64`、`dist/SHA256SUMS.txt`（不纳入源码提交）。
- 仓库旁 `BetterLanTalk-verification/` 保存 `unit-tests.txt`、`browser-tests.txt`、`linux-build.txt`、`linux-bundle.txt`、`windows-build.txt`、`security-tests.txt`。
- 截图：`contact-requests-light.png`、`contact-requests-9x16.png`、`chat-light-desktop.png`、`chat-light-9x16.png`、`contacts-light.png`、`chat-dark.png`。

本次没有迁移用户正式数据。升级前须同时备份数据与私有保护目录，并按 [初始化说明](SECURITY-STORAGE.md) 建立可信基线。防护范围为只能修改普通数据文件的人；服务器及程序完整控制者仍可绕过本地机制。极域通知沿用本地 UDP 回环验证，未连接真实学生端。
