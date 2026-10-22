# 本地更新与验证记录

日期：2026-10-22（北京时间）。分支：`feat/jiyu-popup-notification`。本次版本为 `v1.3.0-beta.1` 预发布版。本记录描述本地验证；Windows／Linux 原生 CI 结果见对应 Release 和 GitHub Actions。

## 完成内容

- 浅色默认主题、SVG 图标、圆角界面、聊天／联系人分离、右侧公告与成员、右上群工具、左下版本／管理／主题工具箱，以及 9:16 半屏抽屉布局。
- Markdown 编辑／预览开关、持久高度调整、文件选择、编辑区和消息区拖放、Ctrl+V 图片、Enter 换行、Ctrl+Enter 发送及中文输入法保护。
- 169 个本地 QQ 表情、分类／搜索／最近使用／斜杠候选、消息回应、引用、精华、搜索与上下文定位、个人与群头像。
- 所有人类用户建公开／私有群、独立群主／群管理、好友定向邀请、自动答案验证／人工审核、公告、转让、个人群昵称／备注／置顶及记录清空。
- 绑定用户 ID 的 @单人和受群角色限制的 @全体；三档群通知统一控制浏览器和极域，完全免打扰保留灰色未读数及提及标记。
- 管理员解绑／换绑 IP、会话即时撤销与审计；无 IP 的 Bot 账号、令牌生命周期、自动好友申请、更新长轮询及受群角色限制的管理 API。
- 更新 [API 文档](API.md)、[Bot 示例](../examples/bot.mjs) 和升级说明。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm --prefix server test` | 57 项通过，0 失败、0 跳过 |
| `npm --prefix server run test:browser` | Chromium 实际操作检查通过，无页面脚本错误 |
| `npm --prefix server run bundle:linux` | Linux x64 构建成功 |
| `npm --prefix server run test:bundle` | Linux 独立程序检查通过 |
| `npm --prefix server run bundle` | Windows x64 exe 交叉构建成功 |
| `git diff --check` | 通过 |

环境：Linux x64、Node.js 24.19.0、Playwright 1.62.1、Chromium 151.0.7922.173。打包运行时为 Node.js 22。浏览器截图使用中文及 Asia/Shanghai 时区。

自动化测试使用临时数据目录和不同的回环来源 IP，覆盖游客／普通用户／管理员资源访问、IP 绑定与换绑、旧群归档、好友与私聊隔离、群角色即时变更、邀请失效、审核、引用／提及／回应／精华、个人清空隔离、设置与数据重启持久化，以及 Bot 并发轮询、令牌重置、队列过期、附件和退群后的更新过滤。

浏览器检查覆盖浅色默认、深色主题保存与气泡配色、纯图标、预览开关持久化、Luogu 前后端渲染一致、中文输入法、键盘发送、表情和 @ 候选、真实 Ctrl+V 图片、拖动防重复、外部拖放、文件下载、右键引用／回应、好友审批与私聊、三档设置、灰色未读及提及标记、半屏布局、编辑区调节、弹窗中的剪贴板回退、通知权限及 Notification API 构造，以及后台 IP／Bot 控件。

独立程序在空工作目录运行，并把 PATH 指向不含 Node.js 的目录，验证打包资源、受保护页面、消息、QQ 表情、上传下载、头像解码保存、群组、Bot、主题及通知设置重启持久化，另验证自定义数据目录。

## 产物与截图

本地产物在 `dist/BetterLanTalk-win-x64.exe` 和 `dist/BetterLanTalk-linux-x64`，校验值在 `dist/SHA256SUMS.txt`；这些构建文件不纳入源码提交。

测试日志和实际截图默认位于仓库旁的 `BetterLanTalk-verification/`，可用 `BROWSER_ARTIFACT_DIR` 修改截图目录：

- `unit-tests.txt`、`browser-tests.txt`、`linux-bundle.txt`、`windows-build.txt`
- `chat-light-desktop.png`、`chat-light-9x16.png`、`contacts-light.png`、`chat-dark.png`

## 验证范围与升级行为

Windows exe 已完成交叉构建和 PE x64 格式检查，当前 Linux 环境没有执行 Windows 实机验证。极域通知验证使用本地 UDP 回环接收器，检查固定文案、通知筛选与 20 秒冷却，未连接真实极域学生端；浏览器检查也不等同于人工确认操作系统通知弹窗外观。

首次启动新版会将旧自建群标记归档并移出会话与搜索列表，保留其数据；默认聊天室、账号、好友、私聊及附件继续保留。新设置、审核、邀请、审计与 Bot 更新存于 `community.json`，头像在 `avatars/`。升级应保留整个数据目录；需要回退时恢复升级前备份。本次测试均在临时目录进行，未运行用户正式数据迁移。
