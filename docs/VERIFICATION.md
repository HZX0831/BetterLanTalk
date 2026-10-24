# v1.3.0 重新发行验证记录

日期：2026-10-24（北京时间）。功能分支将合入 `main`，同名 `v1.3.0` 标签和 Release 同步更新。Windows／Linux 原生源码测试以及 Linux 发行结果以对应 GitHub Actions 为准。

## 本次变化

- 完全删除账号和配置的签名、可信备份、密钥管理、监控恢复与安全初始化；使用普通 JSON 持久化。
- 新增 `superadminIP`：首次部署预设、重启换绑、旧会话撤销、冲突校验，以及面板／API 对固定 IP 的限制。
- 删除 Windows exe 构建及 v1.3.0 附件，只保留 Windows 源码检查和 Linux 独立程序。
- 重写 README，更新 API 和数据迁移说明。

## 本地验证结果

| 检查 | 结果 |
| --- | --- |
| `npm --prefix server test` | 67 项通过，0 失败、0 跳过 |
| `npm --prefix server run test:browser` | Chromium 实际操作通过，无页面脚本错误 |
| `npm --prefix server run bundle:linux` | Linux 构建成功 |
| `npm --prefix server run test:bundle` | Linux 独立程序检查通过 |
| `bash -n start.sh`、`git diff --check` | 通过 |


使用隔离临时数据目录，自动化检查覆盖账号手工改动不被还原、重启读取新角色与密码、旧安全文件损坏也不影响启动、配置手改保留、坏 JSON 明确报错、超管 IP 固定／更换／冲突与令牌撤销。格式仍要求恰好一名超管，不自动代选或重建账号。

既有用例继续覆盖登录与来源 IP、权限资源、好友和私聊、群组与独立角色、Bot、消息引用／提及／回应、三档通知以及本地 UDP 冷却。浏览器回归检查浅色／深色、9:16 半屏、Markdown 预览、键盘发送模式、输入法与候选防误发、图片上传／拖放、申请红标及管理面板。

Linux 独立程序在无 Node.js／无源码工作目录运行，检查资源、聊天、附件、群组、Bot、头像、偏好，以及重启后保留手改账号和配置。构建文件在 `dist/`，不纳入源码提交；发行附件只保留 `BetterLanTalk-linux-x64` 和 `SHA256SUMS.txt`。

测试日志与截图在仓库旁 `BetterLanTalk-verification/`。未迁移用户正式数据，极域使用本地 UDP 回环，未连接真实学生端。

迁移步骤见 [README](../README.md) 与 [数据迁移说明](DATA-MIGRATION.md)。
