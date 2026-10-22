# BetterLanTalk API 文档

适用版本：**v1.2.0**。根据当前发布版本的 [server.js](../server/server.js)、[social.js](../server/social.js) 和 [jiyu.js](../server/jiyu.js) 整理；源码运行与独立程序提供相同接口。

本文包含 40 个 `/api/*` HTTP 接口、文件下载、9 个 Socket.IO 客户端事件，以及对应服务端推送。

## 1. 基础约定

### 1.1 地址、请求与响应

- 默认地址：`http://<服务器IP>:3001`，例如 `http://192.168.1.10:3001`。下文路径均相对于该地址，没有 `/v1` 前缀。
- 除上传文件外，有请求体的接口使用 `Content-Type: application/json`。路径参数和查询参数应进行 URL 编码。
- 业务接口成功均返回 **HTTP 200**，包括创建和删除操作；数组接口直接返回数组，没有统一 `data` 包装。
- 大多数业务错误返回 `{"error":"错误说明"}`。极域测试失败使用自己的统计结构；JSON 语法错误、静态资源错误等也可能由 Express 返回非 JSON 内容。
- 普通时间字段为 Unix 毫秒时间戳；`GET /api/status` 的 `timestamp` 为 ISO 8601 字符串。
- `id`、`userId`、`roomId`、`storedName` 均按不透明字符串使用。账号 ID 稳定，用户名可以修改；不要用用户名替代需要账号 ID 的参数。
- 文档中的用户名、IP、ID、时间和 token 均为示例，实际值以接口返回为准。

### 1.2 鉴权与 IP 绑定

受保护 HTTP 接口接受以下两种会话凭据，**Bearer 优先于 Cookie**：

```http
Authorization: Bearer <token>
```

```http
Cookie: lantalk_session=<token>
```

注册、登录和 `/api/me` 会设置 `HttpOnly`、`SameSite=Strict` 的会话 Cookie；HTTPS 请求时还带 `Secure`。同源浏览器请求可直接携带 Cookie，第三方程序建议使用 Bearer。

token 是有效期 **7 天**的随机字符串，不是 JWT。重新登录创建新 token；`/api/me` 更新 Cookie，但不延长 token 本身的到期时间。注销吊销当前 token；删除账号吊销该账号全部 token。修改密码不会自动吊销已有 token，角色变更则按账号的当前角色即时生效。

**有效 token 仍须从账号绑定的 IP 使用**：

- 新注册账号绑定注册请求的来源 IP；同一 IP 不能关联另一个账号。
- 初始超级管理员及迁移时升级为超级管理员的账号，在首次成功登录时绑定；密码错误不绑定。
- 登录、HTTP API、受保护页面、附件和 Socket.IO 都校验 IP。
- IP 取服务器 TCP 连接的实际对端地址，不信任 `X-Forwarded-For`、`CF-Connecting-IP`。多个设备经代理、NAT 或 Cloudflare Tunnel 共用一个服务器可见 IP 时，会被视为同一设备。
- 同一账号可在同一 IP 的多个标签页建立连接；接口没有强制单连接限制。

### 1.3 权限标记

| 标记 | 条件 |
| --- | --- |
| 公开 | 不需要登录 |
| 登录 | 有效会话且来源 IP 匹配 |
| 管理员 | `admin` 或 `superadmin`，并满足登录条件 |
| 超级管理员 | `superadmin`，并满足登录条件 |
| 会话成员 | 账号在指定群聊或私聊的成员列表中 |
| 群管理 | 当前仍是管理员，且为群创建者或超级管理员；私聊不适用 |

超级管理员可以管理群，但**没有自动读取所有群或他人私聊的权限**。历史、成员、附件读取仍要求会话成员身份。私聊双方解除好友后可读历史及已有附件，但不能发送新消息或上传新附件。

### 1.4 常见状态码

| 状态码 | 常见原因 |
| --- | --- |
| 200 | 成功；极域冷却内忽略提醒也返回 200，应检查 `skipped` |
| 400 | 参数错误、重复用户名、无效历史游标、不能退出默认群等 |
| 401 | 未登录、token 无效或过期、密码错误 |
| 403 | IP 不匹配、权限不足、未加入会话、被禁言等 |
| 404 | 指定账号、申请、文件或管理目标不存在 |
| 409 | 已是好友、申请重复或申请已处理 |
| 413 | 文件超过单文件大小上限；JSON 解析器也有请求体大小限制 |
| 500 | 文件写入失败等服务端异常 |
| 502 | 极域 UDP 测试发送失败 |

## 2. 账号与会话

### POST /api/register

权限：公开。

```json
{"username":"alice","password":"your-password"}
```

`username` 为 2–20 字符字符串，不能重名；`password` 为至少 6 字符字符串。注册后角色固定为 `user`，只加入默认群 `default`，同时完成登录并设置 Cookie。

```json
{"success":true,"token":"<token>","username":"alice","role":"user"}
```

用户名或密码不合法、重名返回 400；IP 已关联账号返回 403。默认超级管理员由服务端首次初始化创建，无需调用注册接口。

### POST /api/login

权限：公开。请求体与注册相同。成功返回相同结构，但 `role` 为账号实际角色，并设置 Cookie。

缺少用户名或密码返回 400；凭据错误返回 401；账号 IP 不符或该 IP 已关联其他账号返回 403。

### GET /api/me

权限：登录。返回当前账号，同时更新会话 Cookie。

```json
{"id":"account-id","username":"alice","role":"user","boundIp":"192.168.1.20","token":"<token>"}
```

### POST /api/logout

权限：登录。无需请求体。吊销当前 token、清除 Cookie，并断开使用该 token 的 Socket 连接。

```json
{"success":true}
```

其他 token 不受此次注销影响。

## 3. 状态与通知地址

### GET /api/status

权限：公开。

```json
{"name":"内网聊天室服务器","version":"1.2.0","status":"running","serverIP":"192.168.1.10","port":3001,"timestamp":"2026-10-22T04:00:00.000Z"}
```

`port` 是本次运行使用的端口；通过 `PORT` 环境变量指定时，该字段可能是字符串。

### GET /api/health

权限：公开。

```json
{"status":"ok","users":2,"rooms":3,"mutedIPs":0,"serverIP":"192.168.1.10","timestamp":1792641600000}
```

`users` 是已完成 Socket `join` 的连接数，多个标签页分别计数，不是去重账号数。

### GET /api/limits

权限：公开。返回上传限制，单位为代码使用的 MB，即 `1024 × 1024` 字节。

```json
{"maxFileMB":5120,"maxUploadsMB":20480}
```

### GET /api/my-notification-devices

权限：登录。返回极域开关和当前账号的绑定 IP；无手动绑定功能。

```json
{"enabled":false,"ips":["192.168.1.20"]}
```

## 4. 好友与私聊

### GET /api/people

权限：登录。查询参数 `q`：用户名子串，忽略大小写，最多返回 30 个账号，不包含自己。空或只有空白的查询返回 `[]`。

请求示例：`/api/people?q=bob`。

```json
[{"id":"bob-id","username":"bob","online":true,"isFriend":false}]
```

### GET /api/social

权限：登录。返回好友，以及自己发出或收到的待处理申请。

```json
{
  "friends":[{"id":"bob-id","username":"bob","online":true}],
  "requests":[{
    "id":"request-id","from":"alice-id","to":"charlie-id",
    "status":"pending","createdAt":1792641600000,
    "fromUser":"alice","toUser":"charlie"
  }]
}
```

这里只返回 `pending` 申请，不提供已处理申请的历史列表；`fromUser`、`toUser` 为用户名字符串。

用户对象的 `online` 表示该账号有已完成 Socket `join` 的连接，不要求正在阅读当前会话。

### POST /api/friend-requests

权限：登录。请求体：`{"userId":"目标账号ID"}`。

```json
{"success":true,"request":{"id":"request-id","from":"alice-id","to":"bob-id","status":"pending","createdAt":1792641600000}}
```

目标不存在 404；添加自己 400；已是好友或双方任一方向已有待处理申请 409。

### PUT /api/friend-requests/:id

权限：登录，且为对应申请的发起人或接收人。`:id` 是申请 ID。

```json
{"action":"accept"}
```

| action | 操作人 | 结果 |
| --- | --- | --- |
| `accept` | 接收人 | 建立好友关系，创建或复用双人私聊 |
| `reject` | 接收人 | 拒绝申请 |
| `withdraw` | 发起人 | 撤回申请 |

接受返回 `{"success":true,"room":Room}`；拒绝、撤回返回 `{"success":true}`。处理后内部状态分别为 `accept`、`reject`、`withdraw`，不再出现在 `/api/social` 的待处理申请中。

申请不存在 404；无效 action 400；操作者不符 403；重复处理 409。

### DELETE /api/friends/:id

权限：登录。`:id` 为好友的**账号 ID**，不是申请 ID。

返回 `{"success":true}`；不是好友返回 404。解除关系后私聊历史及已有附件保留，双方不能再发新消息或上传新附件。

### POST /api/direct-chats

权限：登录，且双方为好友。请求体：`{"userId":"好友账号ID"}`。

返回 `{"room":Room}`，**没有 `success` 字段**。反复调用复用已有私聊；不是好友返回 403。得到房间后通过 Socket `join_room` 切换阅读会话，通过 `send_message`、`send_file` 发送内容。

## 5. 群聊、成员与消息历史

### Room 对象

以下示例为当前用户可以管理的群，普通成员响应不包含 `members`，群聊不包含 `peerId`：

```json
{
  "id":"team","name":"项目讨论","kind":"group","isPublic":false,
  "createdBy":"admin","created":1792641600000,
  "userCount":2,"memberCount":3,"canSend":true,"canManage":true,
  "lastMessage":{"timestamp":1792641600000,"preview":"最近一条消息"},
  "members":["admin","alice","bob"]
}
```

| 字段 | 含义 |
| --- | --- |
| `kind` | `group` 群聊，或 `direct` 双人私聊 |
| `userCount` | 此会话已连接成员的去重账号数，不限于正在阅读此会话的用户 |
| `memberCount` | 会话成员数量，包含离线成员 |
| `canSend` | 当前账号是否可发送；仍需通过禁言等发送检查 |
| `canManage` | 当前账号是否具有群管理权限 |
| `peerId` | 仅私聊：对方账号 ID；私聊的 `name` 显示对方当前用户名 |
| `lastMessage` | 没有消息或调用者不是成员时为 `null`；文字摘要最多 80 字符，附件摘要为 `[文件]` 或 `[图片]` |
| `members` | 仅群管理者可见，内容为成员用户名数组 |

### GET /api/rooms

权限：登录。默认返回自己已加入的群聊及私聊 `Room[]`，包括解除好友后保留的历史私聊。

可加 `?manage=1` 获取当前账号可管理的群：此模式要求管理员，普通用户返回 403。管理列表可能包含超级管理员尚未加入的群，不因此授予其读取历史、附件的权限。

### GET /api/public-rooms

权限：登录。可选查询参数 `q` 按群名子串过滤，忽略大小写；省略时返回全部公开群，不包含私聊。

```json
[{"id":"team","name":"项目讨论","joined":false,"memberCount":3}]
```

### POST /api/rooms

权限：管理员。

```json
{"roomId":"team","roomName":"项目讨论","isPublic":true}
```

- `roomId` 必填，2–20 位英文字母、数字、`_` 或 `-`，不能与现有会话 ID 重复。
- `roomName` 可选，最多 50 字符；省略或空字符串时使用 roomId。
- `isPublic` 可选，布尔值，默认 `true`。

返回 `{"success":true,"message":"房间已创建","room":Room}`。参数错误或 ID 重复返回 400。新群最初只有创建者；公开群也不会自动加入全部用户。

### POST /api/rooms/:roomId/join

权限：登录，仅限公开群。无需请求体，已是成员时可重复调用。

返回 `{"room":Room}`。不存在、非公开群或私聊均返回 403。此接口**加入成员列表**；切换当前阅读会话另用 Socket `join_room`。

### POST /api/rooms/:roomId/leave

权限：群成员。无需请求体，返回 `{"success":true}`。

不是成员或目标为私聊返回 403；不能退出默认群，群创建者不能通过此接口退出，返回 400。

### POST /api/rooms/:roomId/invitations

权限：群管理。请求体：`{"username":"已注册用户名"}`。

```json
{"success":true,"message":"邀请已发送，用户已获得房间访问权限"}
```

邀请立即将账号加入群成员列表，不需要受邀人再次确认；适用于私有群和其他可管理群。受邀人的在线连接会收到 `room_invited`。

房间或账号不存在 404；无管理权限 403；默认群不接受此操作，返回 400。

### GET /api/rooms/:roomId/members

权限：会话成员，包括私聊双方。返回所有有效成员，含离线账号：

```json
[{"id":"alice-id","username":"alice","online":true}]
```

房间不存在或无成员权限均返回 403。

### DELETE /api/rooms/:roomId/members/:userId

权限：群管理。移除指定账号的群成员资格，返回 `{"success":true}`。

没有群管理权限，包括房间不存在时返回 403；默认群成员或群创建者不能移除，返回 400。有效群内目标本来不是成员时，仍返回成功。

### POST /api/rooms/:roomId/kick-users

权限：群管理。无需请求体，移除**除创建者外的全部成员资格**，包含离线成员。

```json
{"success":true,"message":"已移除受邀成员","kickedCount":2}
```

`kickedCount` 为操作前该群关联的在线 Socket 连接数，不是实际移除的账号数。默认群不允许操作，返回 400；房间不存在 404，无管理权限 403。

### DELETE /api/rooms/:roomId

权限：群管理。默认群不可删除。群有关联的在线 Socket 连接时，需查询参数 `force=true`，例如 `/api/rooms/team?force=true`。

```json
{"success":true,"message":"房间已删除","force":true,"kickedUsers":2}
```

`kickedUsers` 为关联 Socket 连接数。在线成员即使正在阅读其他会话，也会使无 `force` 的删除被拒绝。未强制删除且存在连接时返回 `400 {"error":"房间中还有用户，无法删除","userCount":2}`。房间不存在 404，无管理权限 403。

删除同时移除该群的消息历史。此接口不提供附件物理文件的单独删除操作。

### GET /api/rooms/:roomId/messages

权限：会话成员。默认返回最近最多 **100 条**消息，数组内按保存顺序从旧到新排列，消息对象见第 9 节。

向前翻页：`/api/rooms/team/messages?beforeId=<本页第一条消息的ID>`，返回该 ID **之前**最多 100 条，不包含游标消息；返回 `[]` 表示没有更早消息。

无成员权限或房间不存在 403；游标不属于该会话的历史返回 400。没有 `page`、`limit`、按时间查询或消息编辑/删除接口。

## 6. 文件上传与下载

### POST /api/upload

权限：可发送该会话消息的成员，且 IP 未被禁言。

**请求体直接发送文件二进制，不使用 multipart/form-data，也不使用 JSON/base64。** HTTP JSON 解析中间件会处理 `application/json`，所以即使上传 JSON 文件，请求的 Content-Type 也应使用 `application/octet-stream`，真实文件类型放在 `x-mime`。

| 参数或请求头 | 说明 |
| --- | --- |
| 查询参数 `room` | 目标会话 ID，优先级最高 |
| 请求头 `x-room` | 未提供 `room` 时使用；两者均省略时为 `default` |
| `Content-Type` | 使用 `application/octet-stream` |
| `x-filename` | 文件原名，建议 `encodeURIComponent(filename)`，服务端解码并清理危险字符；省略为 `file` |
| `x-mime` | 原文件 MIME，如 `image/png`、`application/pdf`；省略时使用 Content-Type |
| `Authorization` | Bearer token；也可用会话 Cookie |

```bash
curl 'http://192.168.1.10:3001/api/upload?room=default' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/octet-stream' \
  -H 'x-filename: report.txt' \
  -H 'x-mime: text/plain' \
  --data-binary '@report.txt'
```

```json
{"success":true,"file":{"storedName":"1792641600000-abcdef-report.txt","name":"report.txt","size":123,"mimeType":"text/plain","url":"/uploads/1792641600000-abcdef-report.txt","roomId":"default"}}
```

文件名由服务端清理，`size` 为字节数。上传成功后，必须再通过 Socket `send_file` 发送 `storedName` 和**相同 roomId**，才会产生聊天室附件消息。不要将原始文件内容放进 Socket 事件。

目标房间不存在、空文件返回 400；禁言、无发送权限或上传期间权限失效返回 403；超过单文件上限 413；写入失败 500。

超过上传目录总量时，会从最旧文件开始清理，文件列表仍保留 `expired:true` 的记录，并向所属会话推送 `file_expired` 和系统消息。上传结束会执行清理，发送附件消息时也应处理文件已过期的情况。

### GET /api/files

权限：会话成员。查询参数 `room` 默认 `default`。返回该会话文件，按 `createdAt` 从新到旧排序，包含已过期记录：

```json
[{"storedName":"stored-report.txt","name":"report.txt","size":123,"mimeType":"text/plain","uploader":"alice","createdAt":1792641600000,"expired":false,"url":"/uploads/stored-report.txt"}]
```

无权限或房间不存在 403；未提供分页参数。

### GET /uploads/:storedName

权限：文件所属会话成员；可使用 Bearer 或 Cookie。返回文件原始内容，不是 JSON，也不要求文件由自己上传。

文件不存在或已过期返回 404；没有所属会话权限返回 403。私聊附件不因管理员身份而自动可读。

## 7. 账号管理、禁言与广播

### GET /api/accounts

权限：管理员。列出全部注册账号：

```json
[{"id":"alice-id","username":"alice","role":"user","registeredIp":"192.168.1.20","boundIp":"192.168.1.20","createdAt":1792641600000}]
```

`registeredIp` 为历史注册地址，`boundIp` 才是当前登录及极域通知使用的地址。

### GET /api/users

权限：管理员。列出已经 Socket `join` 的在线连接；同一账号的多个连接分别返回：

```json
[{"id":"alice-id","username":"alice","ip":"192.168.1.20","isMuted":false,"joinTime":1792641600000}]
```

这里的 `id` 仍是账号 ID，不是 Socket ID；`joinTime` 是该连接完成 `join` 的时间。

### PUT /api/users/:username

权限：管理员。普通管理员可以修改普通用户及自己的账号，不能修改其他管理员或超级管理员；超级管理员可以修改所有账号。

```json
{"newUsername":"alice-new","newPassword":"new-password"}
```

两个字段均可省略。新用户名 2–20 字符且不能与任何现有用户名重复，包括不能原样提交自己的当前用户名；非空新密码至少 6 字符，空字符串表示不修改密码。

```json
{"success":true,"message":"修改成功","user":{"username":"alice-new","role":"user"}}
```

账号不存在 404；权限不符 403；字段校验失败 400。账号 ID、绑定 IP 不变；用户名相关展示和在线账号信息会更新。客户端应先校验所有字段再提交，当前实现不保证多个修改字段之间的事务原子性。

### DELETE /api/users/:username

权限：管理员。普通管理员只能删除普通用户；超级管理员还可以删除其他管理员。不能删除超级管理员或当前登录账号。

返回 `{"success":true,"message":"用户 alice 已删除"}`。账号不存在 404；受保护管理员身份返回 403；删除自己返回 400。

删除会吊销全部 token、断开相关连接并清理成员/好友关系，释放该账号的绑定 IP；不承诺清空其已有消息或物理附件。

### PUT /api/users/:username/role

权限：超级管理员。请求体：`{"role":"admin"}` 或 `{"role":"user"}`。

```json
{"success":true,"username":"alice","role":"admin"}
```

目标不存在 404；改变超级管理员身份 403；其他 role 值 400。角色即时生效，不改变稳定账号 ID 或 IP 绑定。

### POST /api/mute-ip

权限：管理员。请求体：`{"ip":"192.168.1.20"}`。

返回 `{"success":true,"message":"IP 192.168.1.20 已被禁言"}`。缺少 IP 返回 400。禁言会阻止普通消息、附件发送和上传，但不会踢出连接或阻止读取历史；该接口不自动发出专门的“禁言状态变化”Socket 事件。

### POST /api/unmute-ip

权限：管理员。请求体同禁言。返回 `{"success":true,"message":"IP 192.168.1.20 已解除禁言"}`；缺少 IP 返回 400。

### GET /api/muted-ips

权限：登录，**不要求管理员**。返回字符串数组，例如 `["192.168.1.20"]`。禁言列表只保存在内存，服务重启后清空。

### POST /api/broadcast

权限：管理员。请求体：`{"message":"通知正文"}`。

返回 `{"success":true,"message":"广播发送成功"}`；空值返回 400。广播以 `type:"admin"` 消息写入所有群聊历史并推送，不发往双人私聊；消息 `username` 为实际管理员用户名。广播正文按纯文本使用，没有 Markdown 渲染字段。

## 8. 服务配置与极域通知

### GET /api/config

权限：管理员。

```json
{"port":3001,"maxFileMB":5120,"maxUploadsMB":20480,"serverIP":"","jiyuEnabled":false,"jiyuPort":4988,"detectedIP":"192.168.1.10","localIP":"192.168.1.10"}
```

`serverIP` 是手动设置的对外展示 IP，空字符串表示自动检测；`detectedIP` 是检测结果，`localIP` 是当前展示地址。

### PUT /api/config

权限：管理员。可只提交需要更改的字段：

```json
{"port":3001,"maxFileMB":1024,"maxUploadsMB":4096,"serverIP":"","jiyuEnabled":true,"jiyuPort":4988}
```

| 字段 | 约束与生效方式 |
| --- | --- |
| `port` | 建议使用 1–65535 整数；服务端做数值转换和范围检查，重启后生效。`PORT` 环境变量优先于保存的端口 |
| `maxFileMB` | 正数，单位 `1024²` 字节；不能大于 `maxUploadsMB`，立即生效 |
| `maxUploadsMB` | 正数，单位同上；立即按新总量上限清理旧附件 |
| `serverIP` | IPv4 字符串或空字符串；更新展示地址，不改变账号绑定 IP，也不改变服务监听 `0.0.0.0` 的方式 |
| `jiyuEnabled` | 严格布尔值，自动极域通知开关，立即生效 |
| `jiyuPort` | 严格整数，1–65535，立即生效；未配置时默认 4988 |

```json
{"success":true,"message":"已更新: 极域通知开关、极域端口","port":3001,"maxFileMB":5120,"maxUploadsMB":20480,"serverIP":"","localIP":"192.168.1.10"}
```

返回的 `message` 随修改项变化；PUT 响应**不包含 `jiyuEnabled` 和 `jiyuPort`**，需再次 GET `/api/config` 获取完整结果。参数非法返回 400。

### GET /api/jiyu/devices

权限：管理员。只读返回全部账号的绑定地址；未绑定时 `ip` 为空字符串。

```json
[{"userId":"alice-id","username":"alice","ip":"192.168.1.20"}]
```

### POST /api/jiyu/test

权限：管理员。推荐请求体：`{"userId":"alice-id"}`。兼容 `{"ip":"192.168.1.20"}`，但只能匹配已有账号的绑定地址，不能任意指定目标 IP；同时提供两者时，非空 `userId` 优先。不存在或未绑定的目标返回 400。

正常发送：

```json
{"success":true,"sent":1,"total":1,"failed":0,"skipped":0,"message":"UDP 已发送；是否显示弹窗需在目标设备确认"}
```

冷却期内忽略，仍为 HTTP 200：

```json
{"success":true,"sent":0,"total":1,"failed":0,"skipped":1,"message":"设备处于 20 秒冷却期，本次提醒已忽略"}
```

发送失败返回 HTTP 502，例如：

```json
{"success":false,"sent":0,"total":1,"failed":1,"skipped":0,"message":"UDP 发送失败"}
```

- 手动测试不受 `jiyuEnabled` 总开关限制，总开关关闭时仍可测试。
- 测试与群聊、私聊、广播的自动提醒共用每个目标 IP 的 **20 秒冷却**；期间直接丢弃，不排队、不延长冷却。发送失败也占用冷却，服务重启后冷却状态清空。
- 使用 UDP IPv4；自动提醒会过滤 IPv6 地址，手动测试 IPv6 地址会发送失败。
- 自动提醒要求开关开启，不通知发送者；目标账号只要有一个标签页报告正在阅读该会话，就不发送该会话的极域提醒。其他会话、页面后台或浏览器关闭时可以发送。
- 固定文案为 `from 用户名: new message`、`from 用户名: new file`、`from 用户名: new picture`；手动测试使用操作者用户名及 `new message`。
- `sent` 只证明 UDP 发送回调成功，不代表目标学生端已显示弹窗。

## 9. Socket.IO 实时接口

### 9.1 连接与身份初始化

使用 Socket.IO 4.x 客户端，默认 namespace `/`，默认传输路径 `/socket.io/`。浏览器可加载服务器公开提供的 `/socket.io/socket.io.js`。不能用原生 WebSocket 直接发送下述业务 JSON。

连接成功后必须发送 `join`；仅设置 `io(url, {auth:{token}})` 不会完成当前服务端的账号初始化。以下自定义业务事件**没有 ack 回调协议**，结果通过事件推送确认。

| 客户端事件 | 参数 | 条件与结果 |
| --- | --- | --- |
| `join` | `{token,roomId?:"default"}` | 校验 token、来源 IP 和成员权限；初始化连接并推送账号、会话列表、当前会话、最近 50 条历史及成员信息。省略 token 时回退到握手请求的 Bearer/Cookie |
| `join_room` | `{roomId}` | 已完成 join 且为成员；切换当前阅读会话，推送 `room_joined`、`message_history` 和成员列表，不授予成员资格 |
| `send_message` | `{content,roomId?:"default"}` | 已完成 join、可发送且未禁言；服务端渲染 Luogu Markdown，并向该会话推送 `message` |
| `send_file` | `{storedName,roomId?:"default"}` | 已完成 join、有发送权限且未禁言；文件须是当前账号在同一会话上传、且未过期；推送附件 `message` |
| `typing` | `{isTyping,roomId?:"default"}` | 有发送权限且未禁言时，向该会话其他 Socket 推送 `user_typing` |
| `client_state` | `{isViewing:boolean}` | 已完成 join；更新当前 Socket 是否正在阅读其当前会话，用于极域提醒抑制；每次 join 初值为 false，无确认事件 |
| `get_rooms` | 无 | 请求刷新 `room_list`；实现会广播各连接各自可见的列表，未 join 的连接看到空列表 |
| `create_room` | `{roomId,roomName?,isPublic?:true}` | 已完成 join 的管理员；校验规则同 HTTP 创建群，成功向发起连接推送 `room_created`，不自动切换阅读会话 |
| `delete_room` | `{roomId}` | 群管理；默认群、有关联在线连接的群不能通过此事件删除，成功推送 `room_deleted`；强制删除改用 HTTP |

`send_message`、`send_file`、`typing` 的 roomId 缺省值始终是 **`default`，不是当前阅读会话**。自定义客户端应始终显式传入 roomId。

`send_message.content` 必须为非空白字符串，最多 **20,000 个 JavaScript 字符长度单位**；不符合时静默忽略，不返回 `error`。其他错误一般通过 `error` 事件返回中文字符串，不能将“未收到 error”当成发送成功。`typing`、`client_state` 在条件不符时也可能静默忽略。

发送事件没有客户端幂等键：重复发送相同文本或 `storedName` 会创建新消息。接收端可按服务端 `message.id` 去重，避免重连历史与实时消息在界面重复显示。

### 9.2 服务端推送

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `error` | `errorText:string` | 自定义业务错误；连接建立错误另监听 Socket.IO 的 `connect_error` |
| `account_changed` | `{id,username,role,boundIp?}` | 首次 join 包含 boundIp；账号改名或角色变更的推送通常不包含 boundIp |
| `room_list` | `Room[]` | 当前账号可访问会话列表 |
| `room_joined` | `{roomId,roomName,canSend,kind,userCount}` | 当前阅读会话切换完成 |
| `message_history` | **`(messages:Message[], roomId:string)`** | 两个位置参数；当前会话最近最多 50 条，旧到新。更早历史通过 HTTP 分页读取 |
| `user_list` | **`(members:PublicUser[], roomId:string)`** | 两个位置参数；含离线成员，PublicUser 为 `{id,username,online}` |
| `message` | `Message` | 文本、附件或系统/管理员消息，含 `room`；可能来自当前未阅读的其他已加入会话 |
| `social_changed` | `{friends,requests}` | 与 GET `/api/social` 结构相同 |
| `room_created` | `{roomId,roomName}` | Socket 创建群成功，仅发起连接收到 |
| `room_deleted` | `{roomId,roomName}` | Socket 删除群成功，仅发起连接收到；HTTP 删除不推送此事件 |
| `room_invited` | `{roomId,roomName}` | 账号获得群访问权限 |
| `kicked_from_room` | `{roomId,roomName?,reason}` | 当前阅读会话被移除或删除，随后通常切回默认群 |
| `file_expired` | `{storedName}` | 附件因总量限制清理，不再可下载 |
| `user_typing` | `{username,userId,isTyping,room}` | 同会话其他连接的输入状态 |
| `user_joined` | `{username,room,reason:"join"}` | 成员连接加入提示；刷新/重连可能被抑制 |
| `user_left` | `{username,room,reason:"leave"}` | 最后一个在线连接断开后约 8 秒的离开提示，期间重连会取消 |

成功 `join` 后，连接会订阅该账号**全部已加入会话**。收到 `message` 时应按 `message.room` 分流，只有当前阅读会话才追加到当前消息区，其余用于未读提醒。每次重连都应重新 `join`。

客户端应在 join 成功、切换会话及 `focus`、`blur`、`visibilitychange` 时报告 `client_state`。不报告时初值为 false，即使用户正在阅读，也可能收到该会话的极域提醒。

token 到期时，服务端发送 `error` 后断开连接；注销和账号删除也会断开相关连接。客户端还应监听 Socket.IO 自带的 `connect`、`connect_error`、`disconnect`。

### 9.3 Message 对象

文本消息：

```json
{
  "id":"id-1792641600000-random","type":"text","username":"alice","userId":"alice-id",
  "content":"**你好** $x^2$","processedContent":"<p>服务端处理后的 HTML</p>",
  "isMarkdown":true,"timestamp":1792641600000,"room":"default"
}
```

附件消息：

```json
{
  "id":"id-1792641600000-random","type":"file","username":"alice","userId":"alice-id",
  "name":"image.png","size":123,"mimeType":"image/png",
  "fileUrl":"/uploads/stored-image.png","storedName":"stored-image.png","isImage":true,
  "timestamp":1792641600000,"room":"default"
}
```

管理员/系统消息：

```json
{"id":"id-1792641600000-random","type":"admin","username":"admin","content":"通知正文","timestamp":1792641600000,"room":"default"}
```

系统附件清理消息的 username 为 `系统`。字段随 type 不同，并非所有消息均带 `userId`、`isMarkdown`、`processedContent`。客户端可使用文本消息的 `processedContent` 显示渲染结果；附件下载使用 `fileUrl`，而 HTTP 文件列表使用 `url`。

## 10. 可直接参考的调用流程

### 10.1 登录、连接和发文字

以下 JavaScript 在聊天室同源页面运行，并已加载 `/socket.io/socket.io.js`：

```js
const response = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice', password: 'YOUR_PASSWORD' })
});
const auth = await response.json();
if (!response.ok) throw new Error(auth.error);

const socket = io(location.origin, { autoConnect: false });
socket.on('error', text => console.error('业务错误:', text));
socket.on('connect_error', error => console.error('连接错误:', error.message));
socket.on('message', message => console.log(message.room, message));
socket.on('message_history', (messages, roomId) => console.log('历史:', roomId, messages));
socket.on('user_list', (members, roomId) => console.log('成员:', roomId, members));
socket.on('connect', () => socket.emit('join', { token: auth.token, roomId: 'default' }));
const reportViewing = () => socket.emit('client_state', {
  isViewing: !document.hidden && document.hasFocus()
});
socket.on('room_joined', reportViewing);
for (const event of ['focus', 'blur']) window.addEventListener(event, reportViewing);
document.addEventListener('visibilitychange', reportViewing);
socket.once('room_joined', () => {
  socket.emit('send_message', { roomId: 'default', content: '**你好** $x^2$' });
});
socket.connect();
```

也可以通过命令行获取 token：

```bash
curl 'http://192.168.1.10:3001/api/login' \
  -H 'Content-Type: application/json' \
  --data '{"username":"alice","password":"YOUR_PASSWORD"}'

curl 'http://192.168.1.10:3001/api/rooms' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

登录命令及后续调用必须来自账号绑定的同一来源 IP。

### 10.2 上传并发出附件消息

在已完成 `join` 的连接中，`socket` 和 `auth` 沿用上一示例，`file` 为浏览器 File 对象：

```js
const roomId = 'default';
const uploadResponse = await fetch('/api/upload?room=' + encodeURIComponent(roomId), {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + auth.token,
    'Content-Type': 'application/octet-stream',
    'x-filename': encodeURIComponent(file.name),
    'x-mime': file.type || 'application/octet-stream'
  },
  body: file
});
const result = await uploadResponse.json();
if (!uploadResponse.ok) throw new Error(result.error);
socket.emit('send_file', { roomId, storedName: result.file.storedName });
// 通过后续 message 事件确认附件消息实际送达。
```

### 10.3 建立私聊

1. GET `/api/people?q=bob`，取得目标账号 ID。
2. POST `/api/friend-requests`，提交 `{userId}`。
3. 接收方 PUT `/api/friend-requests/:id`，提交 `{action:"accept"}`，得到私聊 Room。
4. 发起方可从 `room_list` 获取私聊，或 POST `/api/direct-chats` 提交 `{userId}` 取回同一 Room。
5. Socket `join_room` 提交 `{roomId:room.id}` 切换会话；发送事件显式使用这个 roomId。

## 11. 页面资源与当前未提供的接口

| 路径 | 访问条件 |
| --- | --- |
| `GET /` | 登录/注册页；已携带有效且 IP 匹配的会话时重定向 `/chat` |
| `GET /chat` | 登录 |
| `GET /admin` | 管理员 |
| `/client/index.html`、`/client/login.js`、`/client/login.css` | 公开 |
| 允许的 `/client/chat.*`、编辑器、Markdown 等聊天资源 | 登录 |
| `/client/admin.html`、`/client/admin.js`、`/client/admin.css` | 管理员 |
| `/assets/katex/*`、`/assets/prism/*`、`/assets/purify.js` | 登录 |
| `/socket.io/socket.io.js` | 公开的 Socket.IO 浏览器客户端 |

`/client` 采用白名单，不是允许任意文件下载的静态目录。受保护前端及公式等资源使用 `Cache-Control: no-store`。

当前没有 REST 文字/附件消息发送接口、token 刷新接口、消息编辑/删除接口、独立文件删除接口、账号绑定 IP 的修改接口、极域手动绑定 IP 接口。旧的 `PUT /api/jiyu/devices/:userId` 已移除，不应继续调用。
