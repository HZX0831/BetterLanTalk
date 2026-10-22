# BetterLanTalk API

本文对应 `v1.3.0-beta.1` 预发布版本，包含新的群组、Bot、提及及通知档位。源码版和独立程序提供相同接口。原有房间创建／直接加人接口已经停用，见最后一节。

## 请求与权限

默认地址 `http://<服务器IP>:3001`。除文件和头像上传外，请求体为 JSON；成功返回 HTTP 200，数组接口直接返回数组；错误通常为 `{"error":"说明"}`。时间为 Unix 毫秒，ID 为不透明字符串。

人类账号使用 `Authorization: Bearer <token>` 或 `lantalk_session` HttpOnly Cookie（Bearer 优先），token 有效期 7 天。注册绑定来源 IP；初始超级管理员在首次成功登录时绑定。HTTP、源文件、附件及 Socket 均校验实际 TCP 对端 IP，不信任转发头。管理员换绑或解绑会撤销该账号所有会话。Bot 使用专用令牌和专用路径，不接受普通登录，也不能读取前端或后台源码。

权限独立分为全站 `user/admin/superadmin` 和群内 `member/admin/owner`。全站管理员不会自动成为普通群管理员，也不能读取未加入群组的记录。默认公共聊天室由全站管理员管理。删除好友后私聊只读；未入群、退群、移出或群解散后不能读取群消息及附件。

常见错误：400 参数错误，401 未登录／令牌失效，403 权限或 IP 不符，404 目标不存在，409 冲突／申请已处理／账号仍为群主，410 旧接口停用或 Bot 游标过期，413 上传超限，502 UDP 发送失败。

## 账号、好友与个人设置

| 方法与路径 | 权限 | 请求／响应要点 |
| --- | --- | --- |
| `POST /api/register` | 公开 | `{username,password}`；用户名 2–20 字符，密码至少 6 位；返回 token、用户名、角色 |
| `POST /api/login` | 公开 | `{username,password}`；返回 token、用户名、角色 |
| `GET /api/me` | 登录 | 个人资料、稳定 ID、全站角色、绑定 IP、token、主题设置 |
| `POST /api/logout` | 登录 | 撤销当前会话 |
| `GET /api/people?q=关键词` | 登录 | 最多 30 个账号，含 `kind/avatar/isFriend` |
| `GET /api/social` | 登录 | `{friends,requests}`，仅本人待处理好友申请 |
| `POST /api/friend-requests` | 登录 | `{userId}`；返回 `{request}` |
| `PUT /api/friend-requests/:id` | 申请当事人 | `{action:"accept"或"reject"或"withdraw"}`；接受后返回私聊 room |
| `DELETE /api/friends/:userId` | 登录 | 删除自己的好友关系；历史保留 |
| `POST /api/direct-chats` | 好友 | `{userId}`；返回 `{room}` |
| `GET /api/preferences` | 登录 | `{theme,accent,preview}`，默认 `light/#1687f8/true` |
| `PUT /api/preferences` | 登录 | 可部分提交；theme 为 `light/dark/system`；accent 为六位十六进制色值 |
| `PUT /api/rooms/:roomId/settings` | 会话成员 | 部分提交 `nickname/remark/pinned/notificationMode/opened`；`clear:true` 清空个人记录视图；返回 `{settings}` |

群昵称对群内可见，备注仅本人可见。个人清空不删除他人记录及共享精华；消息列表、搜索、引用和上下文遵守个人可见范围。好友列表和聊天最近会话分开，私聊 `opened` 或有新消息后进入最近会话。

### 三档通知

`notificationMode` 为以下枚举，按用户、按群持久保存：

| 值 | 规则 |
| --- | --- |
| `none` | 完全免打扰；@ 也不弹窗，保留灰色未读数字和提及标记 |
| `important` | 群主／群管理员发言，或 @自己／@全体成员 |
| `all` | 所有其他成员的新消息；新加入群默认此档 |

浏览器和极域共用规则，各渠道总开关继续生效；自己发送或正在阅读的当前会话不重复提醒。极域仍按设备执行 20 秒冷却，期间消息直接忽略，文本为 `from 用户名: new message/new file/new picture`。浏览器原生通知需要安全上下文和授权；普通内网 HTTP 仍显示未读状态。关闭网页后的提醒由已启用的极域通知处理，本次未增加 Web Push。

## 群组

以下 `:roomId` 使用创建接口返回的 ID。所有人类用户都可以建群，Bot 不能建群或担任群主。

| 方法与路径 | 权限 | 请求／响应要点 |
| --- | --- | --- |
| `GET /api/groups?q=关键词` | 登录 | 搜索公开群名称或 ID；返回头像、人数、入群方式、问题、是否已加入；不返回标准答案 |
| `POST /api/groups` | 人类登录 | `{name,isPublic,joinMode?,questions?}`；返回 `{room}` |
| `GET /api/groups/:roomId` | 群成员 | 群信息、公告、群角色及个人设置；群管理额外获得 `managementQuestions` |
| `PUT /api/groups/:roomId` | 群管理 | `announcement` 群管理可改；名称、公开性、入群规则及问题仅群主可改 |
| `POST /api/groups/:roomId/join` | 登录 | `{invitationId?,answers?:string[]}`；返回 `{room}` 或 `{pending:true,application}` |
| `POST /api/groups/:roomId/invitations` | 群成员且为目标好友 | `{userId}`；返回 `{invitation,link}`，不会直接加人 |
| `GET /api/group-invitations` | 登录 | 本人有效待处理邀请，含问题和入群方式 |
| `GET /api/groups/:roomId/applications` | 群管理 | 待审申请、申请人及回答 |
| `PUT /api/groups/:roomId/applications/:id` | 群管理 | `{action:"accept"或"reject"}` |
| `PUT /api/groups/:roomId/members/:userId/role` | 群主 | `{role:"admin"或"member"}`；可任命 Bot |
| `PUT /api/groups/:roomId/owner` | 群主 | `{userId}`；仅限群内人类成员；原群主变为普通成员 |
| `DELETE /api/groups/:roomId/members/:userId` | 群管理 | 管理员只能移除普通成员；群主可移除管理员；不能移除群主 |
| `POST /api/groups/:roomId/leave` | 群成员 | 群主须先转让或解散；默认聊天室不能退出 |
| `DELETE /api/groups/:roomId` | 群主或全站管理员 | 解散群组；默认聊天室禁止解散 |
| `GET /api/groups/:roomId/essence` | 群成员 | 群共享精华列表 |
| `PUT /api/groups/:roomId/messages/:id/essence` | 群管理 | `{enabled:boolean}` |

`joinMode` 为 `open/answer/review`，默认为 open。`questions` 是最多 8 个 `{question,answer}`；自动校验至少有一个问题且每题有标准答案，按去除首尾空白后的字符串比较。人工审核的问题可不填标准答案。

私有群不可搜索；邀请绑定接收账号，发出和使用时均检查邀请者仍在群内、双方仍为好友。邀请不绕过问题和审核。待审账号不能访问消息或附件，重复申请返回原待审申请。

## 会话、消息和附件

| 方法与路径 | 权限 | 参数／响应 |
| --- | --- | --- |
| `GET /api/rooms` | 登录 | 本人已加入的群及私聊，含 `settings/groupRole/canManage/lastMessage` |
| `GET /api/rooms?manage=1` | 全站管理员 | 群治理概况；不授予消息读取权限，未加入群不返回预览或成员名单 |
| `GET /api/rooms/:roomId/members` | 会话成员 | 账号资料、群昵称、`groupRole` 和在线状态 |
| `GET /api/rooms/:roomId/messages?beforeId=…` | 会话成员 | 最近最多 100 条，游标消息本身不包含在返回结果 |
| `POST /api/rooms/:roomId/messages` | 可发送的会话成员 | 文字或已上传附件；返回 `{message}` |
| `GET /api/rooms/:roomId/messages/:id/context` | 会话成员 | 目标及前后最多各 15 条消息 |
| `GET /api/rooms/:roomId/search` | 会话成员 | `q/userId/type/from/to`；type 为 text/image/file，from/to 为毫秒；返回最近最多 100 个结果 |
| `PUT /api/rooms/:roomId/messages/:id/reactions` | 可发送的会话成员 | `{emojiId:"14"}`；切换自己的回应，返回 `{message}` |
| `GET /api/files?room=:roomId` | 会话成员 | 附件列表及过期状态 |
| `POST /api/upload?room=:roomId` | 可发送的会话成员 | 原始二进制上传，见下文 |
| `GET /uploads/:storedName` | 附件所属会话成员 | 下载原始文件 |
| `GET /api/files/:storedName/download` | 附件所属会话成员 | 同上，便于 Bot 路径映射 |

文字请求：

```json
{
  "content": "@alice 请查看 :qq[14]:",
  "mentions": [{"type":"user","userId":"稳定账号ID","start":0,"end":6}],
  "replyToId": "同会话原消息ID"
}
```

- 文字最多 20,000 字符。`replyToId`、`mentions` 可省略。引用不自动 @ 原作者。
- 提及位置为 JavaScript UTF-16 的 `[start,end)`；正文对应片段必须正好为 `@当前用户名`。全体提及为 `{"type":"all","start":0,"end":5}`，对应 `@全体成员`，仅群主和群管理员可用。
- 提及绑定用户 ID；服务器检查成员身份、位置、文字和群角色，代码、公式及链接内部不产生提及提醒。普通手写 `@名字` 无 mentions 字段时只是文本。
- QQ 表情用稳定源码 `:qq[14]:` 表示；清单在受保护的 `/client/emoji-data.js`。预览和消息共用解析，代码／公式／链接内部不替换。
- 附件请求为 `{storedName,replyToId?}`，只允许发送本人上传到该会话且未过期的附件。
- 消息包含 `userId/senderKind/senderRole/mentions/replyToId/quote/reactions/essence` 等字段；`senderRole` 是发送时的群角色。回应格式为 `[{emojiId,userIds}]`。

上传使用 `Content-Type: application/octet-stream`、`x-filename: encodeURIComponent(文件名)`、`x-mime: MIME类型`，请求体是文件本身。返回 `{success,file:{storedName,name,size,mimeType,url,roomId}}`；上传成功后再发送消息。权限变化会在上传完成时再次检查。

### 头像

`PUT /api/me/avatar`、`PUT /api/bots/:userId/avatar`、`PUT /api/groups/:roomId/avatar` 上传原始二进制，Content-Type 使用 `application/octet-stream`。仅本人、Bot 的全站管理员、群头像的群管理可操作；对应 DELETE 重置头像。返回 `{avatar:"/avatars/…png"}`。

只接受实际可解码的 PNG/JPEG，最大 4MB、最多 1600 万像素；居中裁剪并输出 256×256 PNG。头像放在独立 `avatars/`，不随聊天附件额度清理。读取头像需要登录。

## IP 与全站管理

| 方法与路径 | 权限 | 参数／响应 |
| --- | --- | --- |
| `GET /api/accounts` | 全站管理员 | 账号 ID、角色、kind、绑定 IP、创建时间等，不返回密码或 Bot 令牌 |
| `PUT /api/accounts/:userId/ip-binding` | 全站管理员 | `{ip:null}` 解绑，或 `{ip:"192.168.1.20"}` 换绑；拒绝占用 IP，立即撤销全部会话 |
| `GET /api/accounts/audit/ip-binding` | 全站管理员 | 操作人、目标、旧／新 IP、时间 |
| `PUT /api/users/:username` | 全站管理员 | `{newUsername?,newPassword?}` |
| `DELETE /api/users/:username` | 全站管理员 | 删除人类账号；群主须先转让／解散；Bot 请走 Bot 删除接口 |
| `PUT /api/users/:username/role` | 超级管理员 | `{role:"admin"或"user"}`；不能调整超级管理员或将 Bot 设为全站管理员 |
| `GET /api/users` | 全站管理员 | 当前在线连接 |
| `POST /api/mute-ip`、`POST /api/unmute-ip` | 全站管理员 | `{ip}` |
| `GET /api/muted-ips` | 登录 | 被禁言 IP 列表 |
| `GET /api/config`、`PUT /api/config` | 全站管理员 | `port/maxFileMB/maxUploadsMB/serverIP/jiyuEnabled/jiyuPort`；端口重启生效，其余按现有规则生效 |
| `POST /api/broadcast` | 全站管理员 | `{message}`，全站群广播，不发送私聊 |
| `GET /api/jiyu/devices` | 全站管理员 | 只读账号绑定 IP |
| `POST /api/jiyu/test` | 全站管理员 | `{userId}`；返回 sent/skipped/failed 等统计；UDP 发送成功不代表目标显示弹窗 |
| `GET /api/my-notification-devices` | 登录 | 本人极域开关及绑定 IP |
| `GET /api/status`、`GET /api/health`、`GET /api/limits` | 公开 | 版本／运行状态／上传额度 |

普通管理员只能修改普通用户及自身；调整其他管理员或超级管理员绑定需超级管理员。解绑后，账号下次正确密码登录绑定当时实际来源 IP。Bot 没有绑定 IP。

## Bot API

### 生命周期

| 方法与路径 | 权限 | 参数／响应 |
| --- | --- | --- |
| `GET /api/bots` | 全站管理员 | Bot 列表 |
| `POST /api/bots` | 全站管理员 | `{username,about?}`；返回 `{bot,token}`，完整令牌仅显示一次 |
| `PUT /api/bots/:userId` | 全站管理员 | 部分提交 `username/about/disabled` |
| `POST /api/bots/:userId/token` | 全站管理员 | 返回新 token；旧 token 立即失效 |
| `DELETE /api/bots/:userId` | 全站管理员 | 删除 Bot、群成员关系及好友关系 |

创建后自动加入默认公共聊天室，向所有人类账号发一次好友申请；新注册用户也收到启用中 Bot 的申请。好友、待处理申请、拒绝／删除后的关系不重复自动申请。服务端只保存令牌哈希。

### 调用方式

发送 `Authorization: Bearer blt_bot_…`，使用 `/api/bot/v1` 前缀：

| Bot 路径 | 对应能力 |
| --- | --- |
| `GET /me` | Bot 自身公开资料 |
| `GET /chats` | 已加入会话 |
| `GET /friends` | 好友及待处理申请 |
| `GET /invitations` | 本人有效群邀请 |
| `GET /updates?offset=0&timeout=30` | 更新长轮询 |
| `/friend-requests/*`、`/direct-chats` | 对应上文 `/api` 下的好友请求及私聊操作 |
| `/groups/*`、`/rooms/*` | 对应上文 `/api` 下的群、消息、设置、回应和审核操作，仍检查群角色 |
| `POST /upload?room=…`、`GET /files?room=…` | 二进制上传、附件列表 |
| `GET /files/:storedName/download` | 授权附件下载 |

不是 Telegram 协议兼容接口；Bot 不支持普通页面、全站管理或创建群组。Bot 可以被任命为群管理员，但不能成为群主。消息发送、@全体、公告、精华、审核和成员操作均使用相同权限规则。

更新响应：

```json
{"updates":[{"updateId":1,"type":"message","data":{},"createdAt":1790000000000}],"nextOffset":1}
```

`offset` 表示已经处理的最大 updateId，下一次传返回的 `nextOffset` 确认消费；未传时使用已持久化的确认游标。每批最多 100 条、timeout 为 0–30 秒，每个 Bot 只允许一个进行中的更新请求，冲突返回 409。更新最多保留 7 天或 10,000 条；过期返回 `410 {error,nextOffset}`，使用该 nextOffset 重新同步。

事件类型包括 `message/message_updated/invitation/join_request/join_result/group_changed/friend_request/friend_result`。Bot 接收已加入群的全部消息及自身私聊，排除自身新发消息；退群后不再返回该群旧队列消息，审核事件只对当前群管理可见。停用、删除和重置令牌也会使正在等待的旧授权请求失效。

可运行示例：[examples/bot.mjs](../examples/bot.mjs)。

## Socket.IO

连接同源服务，先发 `join {token?,roomId?}`，token 可省略并使用 Cookie，roomId 默认 default。加入仅切换已经拥有成员权限的会话，不能代替入群申请。

| 客户端事件 | 参数 |
| --- | --- |
| `join` | `{token?,roomId?}` |
| `join_room` | `{roomId}` |
| `send_message` | `{roomId,content,replyToId?,mentions?}`；与 HTTP 消息接口相同 |
| `send_file` | `{roomId,storedName,replyToId?}` |
| `typing` | `{roomId,isTyping}` |
| `client_state` | `{isViewing}`；用于当前会话已读和极域提醒抑制 |
| `get_rooms` | 请求刷新列表 |

服务端事件：`account_changed`、`room_joined`、`room_list`、`message_history(messages,roomId)`、`message`、`message_updated`、`user_list(members,roomId)`、`user_typing`、`user_joined`、`user_left`、`social_changed`、`community_changed`、`file_expired`、`kicked_from_room`、`group_deleted`、`session_revoked`、`error`。`community_changed` 是刷新信号，应重新获取个人会话／群邀请／设置；不包含群消息数据。

## 已停用的旧接口

以下 HTTP 操作返回 410：`POST /api/rooms`、`POST /api/rooms/:roomId/join`、`POST /api/rooms/:roomId/invitations`、`POST /api/rooms/:roomId/kick-users`、`DELETE /api/rooms/:roomId`。Socket `create_room/delete_room` 返回停用错误。

`POST /api/rooms/:roomId/leave` 和 `DELETE /api/rooms/:roomId/members/:userId` 保留别名，但执行新群权限规则。`GET /api/public-rooms` 保留只读兼容，推荐使用 `/api/groups`。
