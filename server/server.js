const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isIPv4 } = require('net');
const { createJiyuNotifier } = require('./jiyu');
const notifyJiyu = createJiyuNotifier();
const { exec } = require('child_process');

// 预览与消息共用新版 Luogu Markdown 解析器。
const processMarkdown = require('./markdown');

// 简单的ID生成器
function generateId() {
    return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// 获取本机内网IP地址（自动排除虚拟网卡/代理TUN网卡）
function getLocalIP() {
    try {
        const interfaces = os.networkInterfaces();
        const candidates = [];
        for (const name of Object.keys(interfaces)) {
            for (const interfaceInfo of interfaces[name]) {
                if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
                    candidates.push({ name, address: interfaceInfo.address });
                }
            }
        }

        // 排除虚拟/代理类网卡（如 Clash/Mihomo 的 Meta、vEthernet、VMware、VPN 等）
        const isVirtual = (name) =>
            /virtual|vmware|virtualbox|hyper-?v|vethernet|wsl|docker|loopback|tun|tap|npcap|bluetooth|zerotier|tailscale|radmin|vpn|clash|mihomo|meta|proxy|虚拟|加速/i.test(name);
        // 排除特殊/保留网段：198.18.0.0/15（基准测试，常见于代理TUN）、169.254（链路本地）
        const isReserved = (ip) => /^198\.18\./.test(ip) || /^198\.19\./.test(ip) || /^169\.254\./.test(ip);
        // 优先真实物理网卡名（含中文）
        const isPreferred = (name) => /wi-?fi|wlan|无线|ethernet|以太网|本地连接/i.test(name);

        const usable = candidates.filter(c => !isVirtual(c.name) && !isReserved(c.address));
        const preferred = usable.filter(c => isPreferred(c.name));

        if (preferred.length) return preferred[0].address;
        if (usable.length) return usable[0].address;
        if (candidates.length) return candidates[0].address;
    } catch (error) {
        console.log('获取IP地址失败:', error);
    }
    return '127.0.0.1';
}

const app = express();
const server = http.createServer(app);

// ============ 配置与账号存储 ============
const CONFIG_FILE = path.join(__dirname, 'config.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const FILES_FILE = path.join(__dirname, 'files.json');
const ROOMS_FILE = path.join(__dirname, 'rooms.json');
const SOCIAL_FILE = path.join(__dirname, 'social.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

function loadJSON(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
        if (error.code === 'ENOENT') return def;
        throw new Error('无法读取持久化数据 ' + path.basename(file) + ': ' + error.message);
    }
}
function saveJSON(file, data) {
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(file + '.tmp', file);
}

let config = loadJSON(CONFIG_FILE, null) || {};
if (!config.port || isNaN(config.port)) config.port = 3001;
config.port = Number(config.port);
if (!config.maxFileMB || isNaN(config.maxFileMB)) config.maxFileMB = 5120;   // 单文件上限 5GB
if (!config.maxUploadsMB || isNaN(config.maxUploadsMB)) config.maxUploadsMB = 20480; // 上传目录总上限 20GB
config.maxFileMB = Number(config.maxFileMB);
config.maxUploadsMB = Number(config.maxUploadsMB);
if (typeof config.serverIP !== 'string') config.serverIP = '';   // 手动指定的对外IP，留空则自动检测
config.jiyuEnabled = config.jiyuEnabled === true;
config.jiyuPort = Number.isInteger(config.jiyuPort) && config.jiyuPort > 0 && config.jiyuPort <= 65535 ? config.jiyuPort : 4705;
saveJSON(CONFIG_FILE, {
    jiyuEnabled: config.jiyuEnabled, jiyuPort: config.jiyuPort,
    port: config.port,
    maxFileMB: config.maxFileMB,
    maxUploadsMB: config.maxUploadsMB,
    serverIP: config.serverIP
});

// 确保上传目录存在
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// 文件元数据：{ files: [{ storedName, name, size, mimeType, uploader, roomId, createdAt, expired }] }
let fileStore = loadJSON(FILES_FILE, null) || { files: [] };
if (!Array.isArray(fileStore.files)) fileStore.files = [];
function saveFiles() { saveJSON(FILES_FILE, fileStore); }

let userStore = loadJSON(USERS_FILE, null) || { users: [], tokens: {} };
if (Array.isArray(userStore.users) && userStore.users.some(user => !user.id)) {
    for (const file of [USERS_FILE, ROOMS_FILE]) if (fs.existsSync(file) && !fs.existsSync(file + '.pre-social.bak')) fs.copyFileSync(file, file + '.pre-social.bak');
}
if (Array.isArray(userStore.users) && userStore.users.some(user => typeof user.boundIp !== 'string') && fs.existsSync(USERS_FILE) && !fs.existsSync(USERS_FILE + '.pre-ip.bak')) fs.copyFileSync(USERS_FILE, USERS_FILE + '.pre-ip.bak');
if (!Array.isArray(userStore.users)) userStore.users = [];
if (typeof userStore.tokens !== 'object' || !userStore.tokens) userStore.tokens = {};

function saveUsers() { saveJSON(USERS_FILE, userStore); }

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function addUser(username, password, role, registeredIp) {
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
        id: crypto.randomUUID(),
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        role,
        registeredIp: registeredIp || '',
        boundIp: registeredIp || '',
        createdAt: Date.now()
    };
    userStore.users.push(user);
    saveUsers();
    return user;
}

function createToken(username, role) {
    const token = crypto.randomBytes(24).toString('hex');
    userStore.tokens[token] = { username, role, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 };
    saveUsers();
    return token;
}

function getUserByToken(token, ip) {
    if (!token) return null;
    const t = userStore.tokens[token];
    if (!t) return null;
    if (t.expiresAt < Date.now()) {
        delete userStore.tokens[token];
        saveUsers();
        return null;
    }
    const account = userStore.users.find(u => u.username === t.username);
    if (!account || (ip !== undefined && accountIpError(account, ip))) return null;
    return { id: account.id, username: account.username, role: account.role, boundIp: account.boundIp };
}

function normalizeIp(ip) {
    return String(ip || '').replace(/^::ffff:/i, '');
}
function clientIpOf(req) {
    // Direct peer only: an untrusted forwarding header cannot change account identity.
    return normalizeIp(req.socket?.remoteAddress);
}
function accountIpError(account, ip) {
    ip = normalizeIp(ip);
    if (!account.boundIp) return '账号尚未关联设备 IP，请重新登录';
    if (account.boundIp !== ip) return '该账号只能从已关联的设备 IP 登录';
    if (userStore.users.some(other => other.id !== account.id && other.boundIp === ip)) return '此设备 IP 已关联其他账号';
    return null;
}
function bindLoginIp(account, ip) {
    ip = normalizeIp(ip);
    if (!ip) return '无法识别设备 IP';
    if (userStore.users.some(other => other.id !== account.id && other.boundIp === ip)) return '此设备 IP 已关联其他账号';
    if (account.boundIp && account.boundIp !== ip) return '该账号只能从已关联的设备 IP 登录';
    if (!account.boundIp) { account.boundIp = ip; saveUsers(); }
    return null;
}

function requestToken(req) {
    const match = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (match) return match[1];
    const cookie = (req.headers.cookie || '').split(';').find(part => part.trim().startsWith('lantalk_session='));
    return cookie ? cookie.trim().slice('lantalk_session='.length) : null;
}
function sessionCookie(req, res, token) {
    res.cookie('lantalk_session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 7 * 24 * 3600 * 1000 });
}
function authMiddleware(req, res, next) {
    const token = requestToken(req);
    const auth = getUserByToken(token);
    if (!auth) return res.status(401).json({ error: '未登录或登录已过期' });
    const ipError = accountIpError(auth, clientIpOf(req));
    if (ipError) return res.status(403).json({ error: ipError });
    req.auth = auth;
    req.authToken = token;
    next();
}
function isAdmin(account) { return account && ['admin', 'superadmin'].includes(account.role); }
function adminMiddleware(req, res, next) {
    authMiddleware(req, res, () => {
        if (!isAdmin(req.auth)) return res.status(403).json({ error: '需要管理员权限' });
        next();
    });
}
function superadminMiddleware(req, res, next) {
    authMiddleware(req, res, () => {
        if (req.auth.role !== 'superadmin') return res.status(403).json({ error: '需要超级管理员权限' });
        next();
    });
}
// Preserve existing accounts and passwords; promote the initial administrator once.
if (!userStore.users.length) {
    addUser('admin', 'admin123', 'superadmin', '');
    console.log('已创建初始超级管理员 admin / admin123，请登录后修改密码');
} else if (!userStore.users.some(u => u.role === 'superadmin')) {
    const initial = userStore.users.find(u => u.role === 'admin') || userStore.users[0];
    initial.role = 'superadmin';
}
for (const account of userStore.users) {
    if (!account.id) account.id = crypto.randomUUID();
    // Ordinary users retain their registration IP; superadmin binds on first successful login.
    if (typeof account.boundIp !== 'string') account.boundIp = account.role === 'superadmin' ? '' : normalizeIp(account.registeredIp);
    account.boundIp = normalizeIp(account.boundIp);
}
saveUsers();
const social = loadJSON(SOCIAL_FILE, { friends: [], requests: [] });
for (const key of ['friends', 'requests']) if (!Array.isArray(social[key])) social[key] = [];
const accountById = id => userStore.users.find(account => account.id === id);
const accountId = name => userStore.users.find(account => account.username === name)?.id;
const areFriends = (a, b) => social.friends.some(pair => pair.includes(a) && pair.includes(b));
const saveSocial = () => saveJSON(SOCIAL_FILE, social);

const io = new Server(server, {  // ← io 在这里初始化
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const users = new Map();
const rooms = new Map();
const storedMessages = loadJSON(MESSAGES_FILE, { rooms: {} });
const messages = new Map(Object.entries(storedMessages.rooms || {}).filter(([, value]) => Array.isArray(value)));
function saveMessages() { saveJSON(MESSAGES_FILE, { rooms: Object.fromEntries(messages) }); }
const mutedIPs = new Set();
// 对外IP：优先使用配置中手动指定的，否则自动检测
let localIP = (config.serverIP && config.serverIP.trim()) || getLocalIP();

// 离开提示延迟（毫秒）：页面刷新时可被下一次 join 取消，避免刷屏
const LEAVE_DELAY = 8000;
function roomChannel(roomId) { return 'chat-room:' + roomId; }

const pendingLeaves = new Map(); // username -> { timer, roomId }

function broadcastUserJoined(socket, roomId, username, reason) {
    socket.to(roomChannel(roomId)).emit('user_joined', { username, room: roomId, reason });
}

function scheduleUserLeft(roomId, username) {
    // 取消同名的待广播离开
    const existing = pendingLeaves.get(username);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
        pendingLeaves.delete(username);
        // 若期间用户又回来了（有在线 socket），则不广播离开
        const stillOnline = Array.from(users.values()).some(u => u.username === username);
        if (stillOnline) return;
        io.to(roomChannel(roomId)).emit('user_left', { username, room: roomId, reason: 'leave' });
        console.log(`用户 ${username} 离开房间 ${roomId}（延迟提示）`);
    }, LEAVE_DELAY);

    pendingLeaves.set(username, { timer, roomId });
}

function cancelPendingLeave(username) {
    const existing = pendingLeaves.get(username);
    if (existing) {
        clearTimeout(existing.timer);
        pendingLeaves.delete(username);
        return true; // 说明这是一次"刷新/重连"，跳过加入提示
    }
    return false;
}

// ============ 文件存储辅助函数 ============
function sanitizeFilename(name) {
    let base = path.basename(String(name || 'file')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
    if (!base || base === '.' || base === '..') base = 'file';
    if (base.length > 100) {
        const ext = path.extname(base).slice(0, 10);
        base = base.slice(0, 90) + ext;
    }
    return base;
}

function getUploadsTotalSize() {
    let total = 0;
    fileStore.files.forEach(f => { if (!f.expired && f.size) total += f.size; });
    return total;
}

// 按时间从旧到新清理，直到总量 <= 上限；被清理的文件标记为已过期
function cleanupUploads() {
    const limitBytes = config.maxUploadsMB * 1024 * 1024;
    if (getUploadsTotalSize() <= limitBytes) return [];

    const removed = [];
    const active = fileStore.files.filter(f => !f.expired).sort((a, b) => a.createdAt - b.createdAt);
    for (const f of active) {
        if (getUploadsTotalSize() <= limitBytes) break;
        const filePath = path.join(UPLOADS_DIR, f.storedName);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.error('删除文件失败:', e.message); }
        f.expired = true;
        removed.push(f);
        console.log(`🧹 因空间限制清理文件: ${f.name} (${f.storedName})`);
    }
    if (removed.length) {
        saveFiles();
        // 向文件所在房间广播过期通知
        removed.forEach(f => {
            if (f.roomId && rooms.has(f.roomId)) {
                const msg = {
                    id: generateId(),
                    type: 'admin',
                    username: '系统',
                    content: `⚠️ 文件 "${f.name}" 因存储空间限制已过期，无法再下载`,
                    timestamp: Date.now(),
                    room: f.roomId
                };
                messages.get(f.roomId)?.push(msg);
                io.to(roomChannel(f.roomId)).emit('message', msg);
                io.to(roomChannel(f.roomId)).emit('file_expired', { storedName: f.storedName });
            }
        });
        saveMessages();
    }
    return removed;
}

// 启动时执行一次清理
cleanupUploads();

// Room membership is independent of which room the user is currently viewing.
function saveRooms() {
    saveJSON(ROOMS_FILE, { membershipVersion: 2, rooms: Array.from(rooms.values()).map(({ users, ...room }) => room) });
}
function canAccessRoom(account, room) {
    return !!account && !!room && room.memberIds.includes(account.id);
}
function canManageRoom(account, room) {
    return isAdmin(account) && !!room && room.kind !== 'direct' && (account.role === 'superadmin' || room.createdBy === account.username);
}
function canSendRoom(account, room) {
    return canAccessRoom(account, room) && (room.kind !== 'direct' || areFriends(...room.memberIds));
}
function roomInfo(room, account) {
    const other = room.kind === 'direct' ? accountById(room.memberIds.find(id => id !== account?.id)) : null;
    const last = canAccessRoom(account, room) ? (messages.get(room.id) || []).at(-1) : null;
    return { id: room.id, name: room.kind === 'direct' ? other?.username || '已删除的用户' : room.name,
        kind: room.kind || 'group', isPublic: room.isPublic, createdBy: room.createdBy,
        created: room.created, userCount: new Set(room.users.map(u => u.id)).size,
        memberCount: room.memberIds.length, canSend: canSendRoom(account, room), peerId: other?.id,
        lastMessage: last ? { timestamp: last.timestamp, preview: last.type === 'file' ? (last.isImage ? '[图片]' : '[文件]') : String(last.content || '').slice(0, 80) } : null,
        canManage: canManageRoom(account, room),
        ...(canManageRoom(account, room) ? { members: room.memberIds.map(id => accountById(id)?.username).filter(Boolean) } : {}) };
}
function visibleRooms(account, managing = false) {
    return Array.from(rooms.values()).filter(room => managing ? canManageRoom(account, room) : canAccessRoom(account, room)).map(room => roomInfo(room, account));
}
function socketUser(socket) {
    const user = users.get(socket.id);
    const account = getUserByToken(socket.data.token, socket.handshake.address);
    if (!user || !account) return null;
    user.id = account.id;
    user.username = account.username;
    user.role = account.role;
    return user;
}
function syncRoomSubscriptions() {
    for (const socket of io.sockets.sockets.values()) {
        const user = socketUser(socket);
        if (!user) continue;
        for (const room of rooms.values()) {
            room.users = room.users.filter(u => u.socketId !== socket.id);
            if (canAccessRoom(user, room)) {
                socket.join(roomChannel(room.id));
                room.users.push(user);
            } else {
                socket.leave(roomChannel(room.id));
                if (user.currentRoom === room.id) {
                    socket.emit('kicked_from_room', { roomId: room.id, reason: '已失去此会话的成员权限' });
                    switchRoom(socket, user, rooms.get('default'));
                }
            }
        }
    }
    for (const room of rooms.values()) updateUserList(room.id);
    broadcastRoomList();
}
function createRoom(roomId, roomName, isPublic = true, createdBy = '') {
    const room = { id: roomId, name: roomName || roomId, isPublic, createdBy,
        members: [createdBy].filter(Boolean), memberIds: createdBy ? [accountId(createdBy)] : [], kind: 'group', users: [], created: Date.now() };
    rooms.set(roomId, room);
    messages.set(roomId, []);
    saveRooms();
    syncRoomSubscriptions();
    return room;
}
function roomCreationError(account, data) {
    if (!isAdmin(account)) return '需要管理员权限';
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '房间参数无效';
    const { roomId, roomName, isPublic = true } = data;
    if (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{2,20}$/.test(roomId)) return '房间ID应为2-20位字母、数字、下划线或连字符';
    if (roomName !== undefined && (typeof roomName !== 'string' || roomName.length > 50)) return '房间名称最多50个字符';
    if (typeof isPublic !== 'boolean') return '请选择公开或私有房间';
    if (rooms.has(roomId)) return '房间已存在';
    return null;
}
function broadcastRoomList() {
    for (const socket of io.sockets.sockets.values()) {
        const account = getUserByToken(socket.data.token, socket.handshake.address);
        socket.emit('room_list', visibleRooms(account));
    }
}
function updateUserList(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const list = room.memberIds.map(id => accountById(id)).filter(Boolean).map(account => ({
        id: account.id, username: account.username, online: room.users.some(user => user.id === account.id)
    }));
    io.to(roomChannel(roomId)).emit('user_list', list, roomId);
}
function switchRoom(socket, user, room) {
    user.currentRoom = room.id;
    socket.emit('room_joined', { roomId: room.id, roomName: roomInfo(room, user).name, canSend: canSendRoom(user, room), kind: room.kind, userCount: new Set(room.users.map(member => member.username)).size });
    socket.emit('message_history', (messages.get(room.id) || []).slice(-50), room.id);
    updateUserList(room.id);
}

// 中间件
app.use(cors());
app.use(express.json());
const clientDir = path.join(__dirname, '../client');
app.use('/client', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    let resource;
    try { resource = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }
    if (resource.includes('%') || resource.includes('\\') || resource.includes('\0') || resource.split('/').some(part => part === '.' || part === '..')) return res.sendStatus(400);
    const publicFiles = ['/index.html', '/login.js', '/login.css'];
    if (publicFiles.includes(resource)) return next();
    const gate = /^\/admin(?:\.|\/)/i.test(resource) ? adminMiddleware : authMiddleware;
    const protectedFiles = ['/chat.html', '/chat.js', '/styles.css', '/composer.js', '/notifications.js', '/markdown.js',
        '/admin.html', '/admin.js', '/admin.css', '/vendor/luogu-markdown-editor/luogu-parser.js'];
    gate(req, res, () => protectedFiles.includes(resource) ? next() : res.sendStatus(404));
}, express.static(clientDir, { index: false, dotfiles: 'deny' }));
app.use('/assets', authMiddleware, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/assets/katex', express.static(path.join(__dirname, 'node_modules/katex/dist')));
app.use('/assets/prism', express.static(path.join(__dirname, 'node_modules/prismjs')));
app.get('/assets/purify.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/dompurify/dist/purify.min.js')));
app.get('/uploads/:storedName', authMiddleware, (req, res) => {
    const file = fileStore.files.find(f => f.storedName === req.params.storedName);
    if (!file || file.expired) return res.status(404).json({ error: '文件不存在或已过期' });
    if (!canAccessRoom(req.auth, rooms.get(file.roomId))) return res.status(403).json({ error: '未获邀请，无法访问房间文件' });
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
    res.sendFile(path.join(UPLOADS_DIR, file.storedName));
});

// Migrate legacy public groups once, keeping access for existing accounts.
const storedRooms = loadJSON(ROOMS_FILE, { rooms: [] });
for (const saved of (Array.isArray(storedRooms.rooms) ? storedRooms.rooms : [])) {
    if (typeof saved.id !== 'string') continue;
    const memberIds = Array.isArray(saved.memberIds) ? saved.memberIds :
        saved.isPublic !== false ? userStore.users.map(user => user.id) : (saved.members || []).map(accountId).filter(Boolean);
    rooms.set(saved.id, { ...saved, kind: saved.kind || 'group', isPublic: saved.isPublic !== false,
        members: Array.isArray(saved.members) ? saved.members : [], memberIds, users: [] });
    if (!messages.has(saved.id)) messages.set(saved.id, []);
}
if (!rooms.has('default')) createRoom('default', '默认聊天室');
rooms.get('default').isPublic = true;
rooms.get('default').memberIds = userStore.users.map(account => account.id);
saveRooms();
saveMessages();

// Separate pages; protected sources are never part of the login response.
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (getUserByToken(requestToken(req), clientIpOf(req))) return res.redirect('/chat');
    res.sendFile(path.join(clientDir, 'index.html'));
});
app.get('/chat', authMiddleware, (req, res) => {
    res.set('Cache-Control', 'no-store'); res.sendFile(path.join(clientDir, 'chat.html'));
});
app.get('/admin', adminMiddleware, (req, res) => {
    res.set('Cache-Control', 'no-store'); res.sendFile(path.join(clientDir, 'admin.html'));
});

app.get('/api/status', (req, res) => {
    res.json({
        name: '内网聊天室服务器',
        version: '1.1.1',
        status: 'running',
        serverIP: localIP,
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        users: users.size,
        rooms: rooms.size,
        mutedIPs: mutedIPs.size,
        serverIP: localIP,
        timestamp: Date.now()
    });
});

app.get('/api/my-notification-devices', authMiddleware, (req, res) => res.json({ enabled: config.jiyuEnabled, ips: req.auth.boundIp ? [req.auth.boundIp] : [] }));

app.get('/api/users', adminMiddleware, (req, res) => {
    const userList = Array.from(users.values()).map(user => ({
        id: user.id,
        username: user.username,
        ip: user.ip,
        isMuted: user.isMuted,
        joinTime: user.joinTime
    }));
    res.json(userList);
});

app.post('/api/mute-ip', adminMiddleware, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP地址不能为空' });

    mutedIPs.add(ip);
    users.forEach(user => {
        if (user.ip === ip) user.isMuted = true;
    });

    console.log(`IP ${ip} 已被禁言`);
    res.json({ success: true, message: `IP ${ip} 已被禁言` });
});

app.post('/api/unmute-ip', adminMiddleware, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP地址不能为空' });

    mutedIPs.delete(ip);
    users.forEach(user => {
        if (user.ip === ip) user.isMuted = false;
    });

    console.log(`IP ${ip} 已解除禁言`);
    res.json({ success: true, message: `IP ${ip} 已解除禁言` });
});

// ============ 账号相关 API ============
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || username.length < 2 || username.length > 20) {
        return res.status(400).json({ error: '用户名长度应为2-20个字符' });
    }
    if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: '密码长度至少6位' });
    }
    if (userStore.users.some(u => u.username === username)) {
        return res.status(400).json({ error: '用户名已存在' });
    }
    const ip = clientIpOf(req);
    if (ip && userStore.users.some(u => u.boundIp === ip)) {
        return res.status(403).json({ error: '此设备 IP 已关联其他账号，每个 IP 只能使用一个账号' });
    }
    const account = addUser(username, password, 'user', ip);
    rooms.get('default').memberIds.push(account.id);
    saveRooms();
    syncRoomSubscriptions();
    const token = createToken(username, 'user');
    console.log(`新用户注册: ${username} (IP: ${ip})`);
    sessionCookie(req, res, token);
    res.json({ success: true, token, username, role: 'user' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    const user = userStore.users.find(u => u.username === username);
    if (!user || user.passwordHash !== hashPassword(password, user.salt)) {
        return res.status(401).json({ error: '用户名或密码错误' });
    }
    const ipError = bindLoginIp(user, clientIpOf(req));
    if (ipError) return res.status(403).json({ error: ipError });
    const token = createToken(user.username, user.role);
    console.log(`用户登录: ${user.username} (${user.role})`);
    sessionCookie(req, res, token);
    res.json({ success: true, token, username: user.username, role: user.role });
});

app.get('/api/me', authMiddleware, (req, res) => {
    sessionCookie(req, res, req.authToken);
    const user = userStore.users.find(u => u.username === req.auth.username);
    res.json({ id: user.id, username: req.auth.username, role: user ? user.role : req.auth.role, boundIp: user.boundIp, token: req.authToken });
});

app.post('/api/logout', authMiddleware, (req, res) => {
    delete userStore.tokens[req.authToken];
    res.clearCookie('lantalk_session');
    saveUsers();
    for (const socket of io.sockets.sockets.values()) {
        if (socket.data.token === req.authToken) socket.disconnect(true);
    }
    res.json({ success: true });
});

// 账号管理（仅管理员）
app.get('/api/accounts', adminMiddleware, (req, res) => {
    res.json(userStore.users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        registeredIp: u.registeredIp,
        boundIp: u.boundIp,
        createdAt: u.createdAt
    })));
});

app.put('/api/users/:username', adminMiddleware, (req, res) => {
    const user = userStore.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (req.auth.role !== 'superadmin' && (user.role === 'superadmin' || (user.role === 'admin' && user.username !== req.auth.username))) return res.status(403).json({ error: '不能修改其他管理员账号' });

    const { newUsername, newPassword } = req.body;
    if (newUsername !== undefined) {
        if (typeof newUsername !== 'string' || newUsername.length < 2 || newUsername.length > 20) {
            return res.status(400).json({ error: '用户名长度应为2-20个字符' });
        }
        if (userStore.users.some(u => u.username === newUsername)) {
            return res.status(400).json({ error: '新用户名已被占用' });
        }
        Object.values(userStore.tokens).forEach(t => {
            if (t.username === user.username) t.username = newUsername;
        });
        for (const room of rooms.values()) {
            room.members = room.members.map(name => name === user.username ? newUsername : name);
            if (room.createdBy === user.username) room.createdBy = newUsername;
        }
        for (const file of fileStore.files) if (file.uploader === user.username) file.uploader = newUsername;
        user.username = newUsername;
        saveRooms();
        saveFiles();
    }
    if (newPassword !== undefined && newPassword !== '') {
        if (typeof newPassword !== 'string' || newPassword.length < 6) {
            return res.status(400).json({ error: '密码长度至少6位' });
        }
        user.salt = crypto.randomBytes(16).toString('hex');
        user.passwordHash = hashPassword(newPassword, user.salt);
    }
    saveUsers();
    syncRoomSubscriptions();
    socialChanged();
    for (const socket of io.sockets.sockets.values()) if (getUserByToken(socket.data.token)?.username === user.username) socket.emit('account_changed', { id: user.id, username: user.username, role: user.role });
    console.log(`管理员修改账号: ${req.params.username} -> ${user.username}`);
    res.json({ success: true, message: '修改成功', user: { username: user.username, role: user.role } });
});

app.delete('/api/users/:username', adminMiddleware, (req, res) => {
    const user = userStore.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.role === 'superadmin' || (req.auth.role !== 'superadmin' && user.role === 'admin')) return res.status(403).json({ error: '不能删除该管理员账号' });
    if (user.username === req.auth.username) {
        return res.status(400).json({ error: '不能删除当前登录的账号' });
    }
    userStore.users = userStore.users.filter(u => u.username !== user.username);
    Object.keys(userStore.tokens).forEach(t => {
        if (userStore.tokens[t].username === user.username) delete userStore.tokens[t];
    });
    saveUsers();
    for (const socket of io.sockets.sockets.values()) if (!getUserByToken(socket.data.token)) socket.disconnect(true);
    for (const room of rooms.values()) {
        room.members = room.members.filter(name => name !== user.username);
        room.memberIds = room.memberIds.filter(id => id !== user.id);
        if (room.createdBy === user.username) room.createdBy = '';
    }
    saveRooms();
    syncRoomSubscriptions();
    social.friends = social.friends.filter(pair => !pair.includes(user.id));
    social.requests = social.requests.filter(request => request.from !== user.id && request.to !== user.id);
    saveSocial(); socialChanged();
    console.log(`管理员删除账号: ${user.username}`);
    res.json({ success: true, message: `用户 ${user.username} 已删除` });
});

app.put('/api/users/:username/role', superadminMiddleware, (req, res) => {
    const account = userStore.users.find(user => user.username === req.params.username);
    if (!account) return res.status(404).json({ error: '用户不存在' });
    if (account.role === 'superadmin') return res.status(403).json({ error: '不能更改超级管理员身份' });
    if (!['admin', 'user'].includes(req.body.role)) return res.status(400).json({ error: '角色必须为管理员或普通用户' });
    account.role = req.body.role;
    saveUsers();
    for (const socket of io.sockets.sockets.values()) {
        if (getUserByToken(socket.data.token)?.username === account.username) socket.emit('account_changed', { id: account.id, username: account.username, role: account.role });
    }
    syncRoomSubscriptions();
    res.json({ success: true, username: account.username, role: account.role });
});

// 服务器配置
app.get('/api/config', adminMiddleware, (req, res) => {
    res.json({
        port: config.port,
        maxFileMB: config.maxFileMB,
        maxUploadsMB: config.maxUploadsMB,
        serverIP: config.serverIP || '',
        jiyuEnabled: config.jiyuEnabled, jiyuPort: config.jiyuPort,
        detectedIP: getLocalIP(),
        localIP
    });
});

// 公开的文件限制（供客户端上传前预校验）
app.get('/api/limits', (req, res) => {
    res.json({ maxFileMB: config.maxFileMB, maxUploadsMB: config.maxUploadsMB });
});

// 房间文件列表（右侧栏）
app.get('/api/files', authMiddleware, (req, res) => {
    const roomId = String(req.query.room || 'default');
    if (!canAccessRoom(req.auth, rooms.get(roomId))) return res.status(403).json({ error: '无权访问该房间' });
    const list = fileStore.files
        .filter(f => f.roomId === roomId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(f => ({
            storedName: f.storedName,
            name: f.name,
            size: f.size,
            mimeType: f.mimeType,
            uploader: f.uploader,
            createdAt: f.createdAt,
            expired: !!f.expired,
            url: `/uploads/${encodeURIComponent(f.storedName)}`
        }));
    res.json(list);
});

app.put('/api/config', adminMiddleware, (req, res) => {
    const { port, maxFileMB, maxUploadsMB, serverIP, jiyuEnabled, jiyuPort } = req.body;
    if (jiyuEnabled !== undefined && typeof jiyuEnabled !== 'boolean') return res.status(400).json({ error: '极域开关必须为布尔值' });
    if (jiyuPort !== undefined && (!Number.isInteger(jiyuPort) || jiyuPort < 1 || jiyuPort > 65535)) return res.status(400).json({ error: '极域端口应为1-65535的整数' });
    const updated = [];
    const nextConfig = { ...config };

    if (port !== undefined) {
        const p = Number(port);
        if (!p || isNaN(p) || p < 1 || p > 65535) {
            return res.status(400).json({ error: '端口号应为1-65535之间的数字' });
        }
        nextConfig.port = p;
        updated.push(`端口 ${p}（重启生效）`);
    }
    if (serverIP !== undefined) {
        const ip = String(serverIP).trim();
        const isValidIPv4 = (s) => {
            const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
            return !!m && m.slice(1).every(p => Number(p) >= 0 && Number(p) <= 255);
        };
        if (ip && !isValidIPv4(ip)) {
            return res.status(400).json({ error: '对外IP格式无效，应为如 192.168.1.10，留空表示自动检测' });
        }
        nextConfig.serverIP = ip;

        updated.push(`对外IP ${ip || getLocalIP()}`);
    }
    if (maxFileMB !== undefined) {
        const m = Number(maxFileMB);
        if (!m || isNaN(m) || m <= 0) {
            return res.status(400).json({ error: '单文件上限应为正整数(MB)' });
        }
        nextConfig.maxFileMB = m;
        updated.push(`单文件上限 ${m}MB`);
    }
    if (maxUploadsMB !== undefined) {
        const m = Number(maxUploadsMB);
        if (!m || isNaN(m) || m <= 0) {
            return res.status(400).json({ error: '上传目录总上限应为正整数(MB)' });
        }
        nextConfig.maxUploadsMB = m;
        updated.push(`上传目录总上限 ${m}MB`);
    }
    if (nextConfig.maxFileMB > nextConfig.maxUploadsMB) {
        return res.status(400).json({ error: '单文件上限不能大于上传目录总上限' });
    }

    if (jiyuEnabled !== undefined) { nextConfig.jiyuEnabled = jiyuEnabled; updated.push('极域通知开关'); }
    if (jiyuPort !== undefined) { nextConfig.jiyuPort = jiyuPort; updated.push('极域端口'); }
    Object.assign(config, nextConfig);
    localIP = nextConfig.serverIP || getLocalIP();
    saveJSON(CONFIG_FILE, {
        jiyuEnabled: nextConfig.jiyuEnabled, jiyuPort: nextConfig.jiyuPort,
        port: nextConfig.port,
        maxFileMB: nextConfig.maxFileMB,
        maxUploadsMB: nextConfig.maxUploadsMB,
        serverIP: nextConfig.serverIP
    });
    // 修改上限后立即按新上限清理一次
    cleanupUploads();
    res.json({
        success: true,
        message: updated.length ? '已更新: ' + updated.join('、') : '无改动',
        port: nextConfig.port,
        maxFileMB: nextConfig.maxFileMB,
        maxUploadsMB: nextConfig.maxUploadsMB,
        serverIP: nextConfig.serverIP,
        localIP
    });
});

// ============ 文件上传 API ============
app.post('/api/upload', authMiddleware, (req, res) => {
    const ip = clientIpOf(req);

    // 被禁言的 IP 不允许上传
    if (mutedIPs.has(ip)) {
        return res.status(403).json({ error: '你的IP已被禁言，无法上传文件' });
    }

    const roomId = String(req.query.room || req.headers['x-room'] || 'default');
    if (!rooms.has(roomId)) {
        return res.status(400).json({ error: '目标房间不存在' });
    }
    if (!canSendRoom(req.auth, rooms.get(roomId))) return res.status(403).json({ error: '无权访问该房间' });

    let originalName = 'file';
    try { originalName = decodeURIComponent(String(req.headers['x-filename'] || 'file')); } catch (e) {}
    const safeName = sanitizeFilename(originalName);
    const mimeType = String(req.headers['x-mime'] || req.headers['content-type'] || 'application/octet-stream');
    const maxFileBytes = config.maxFileMB * 1024 * 1024;

    const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
    const filePath = path.join(UPLOADS_DIR, storedName);
    const writeStream = fs.createWriteStream(filePath);

    // 预检 Content-Length，超限直接拒绝（避免读取超大请求体）
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength && declaredLength > maxFileBytes) {
        res.set('Connection', 'close');
        res.status(413).json({ error: `文件超过单文件上限 ${config.maxFileMB}MB` });
        res.on('finish', () => req.destroy());
        return;
    }

    let received = 0;
    let aborted = false;

    const abortUpload = (status, message) => {
        if (aborted) return;
        aborted = true;
        req.unpipe(writeStream);
        writeStream.destroy();
        fs.unlink(filePath, () => {});
        if (!res.headersSent) {
            res.set('Connection', 'close');
            res.status(status).json({ error: message });
            res.on('finish', () => req.destroy());
        }
    };

    req.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxFileBytes) {
            abortUpload(413, `文件超过单文件上限 ${config.maxFileMB}MB`);
        }
    });

    writeStream.on('error', (err) => {
        console.error('文件写入失败:', err.message);
        abortUpload(500, '文件写入失败');
    });

    writeStream.on('finish', () => {
        if (aborted) return;
        if (received === 0) {
            fs.unlink(filePath, () => {});
            return res.status(400).json({ error: '空文件' });
        }

        const account = getUserByToken(req.authToken);
        if (!canSendRoom(account, rooms.get(roomId))) {
            fs.unlink(filePath, () => {});
            return res.status(403).json({ error: '房间访问权限已失效' });
        }
        const record = {
            storedName,
            name: safeName,
            size: received,
            mimeType,
            uploader: account.username,
            roomId,
            createdAt: Date.now(),
            expired: false
        };
        fileStore.files.push(record);
        saveFiles();
        cleanupUploads();

        console.log(`📎 文件上传: ${safeName} (${(received / 1048576).toFixed(2)}MB) by ${req.auth.username} -> ${roomId}`);
        res.json({
            success: true,
            file: {
                storedName,
                name: safeName,
                size: received,
                mimeType,
                url: `/uploads/${encodeURIComponent(storedName)}`,
                roomId
            }
        });
    });

    req.pipe(writeStream);
});

app.get('/api/muted-ips', authMiddleware, (req, res) => {
    res.json(Array.from(mutedIPs));
});

app.post('/api/broadcast', adminMiddleware, (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: '消息不能为空' });

    const adminMessage = {
        id: generateId(),
        type: 'admin',
        username: req.auth.username,
        content: message,
        timestamp: Date.now()
    };

    rooms.forEach((room, roomId) => {
        if (room.kind === 'direct') return;
        const message = { ...adminMessage, room: roomId };
        messages.get(roomId)?.push(message);
        io.to(roomChannel(roomId)).emit('message', message);
        notifyJiyuRoom(room, req.auth.id, message);
    });
    saveMessages();
    res.json({ success: true, message: '广播发送成功' });
});
app.post('/api/rooms', adminMiddleware, (req, res) => {
    const error = roomCreationError(req.auth, req.body);
    if (error) return res.status(400).json({ error });
    const { roomId, roomName, isPublic = true } = req.body;
    const room = createRoom(roomId, roomName, isPublic, req.auth.username);
    res.json({ success: true, message: '房间已创建', room: roomInfo(room, req.auth) });
});
function managedRoom(req, res, next) {
    const room = rooms.get(req.params.roomId);
    if (!room) return res.status(404).json({ error: '房间不存在' });
    if (!canManageRoom(req.auth, room)) return res.status(403).json({ error: '仅房间创建者或超级管理员可管理此房间' });
    req.room = room;
    next();
}
app.post('/api/rooms/:roomId/invitations', adminMiddleware, managedRoom, (req, res) => {
    const room = req.room;
    if (room.id === 'default') return res.status(400).json({ error: '默认群自动加入所有账号' });
    if (!userStore.users.some(u => u.username === req.body.username)) return res.status(404).json({ error: '该账号不存在，请先注册' });
    if (!room.members.includes(req.body.username)) room.members.push(req.body.username);
    const id = accountId(req.body.username);
    if (!room.memberIds.includes(id)) room.memberIds.push(id);
    saveRooms();
    syncRoomSubscriptions();
    for (const socket of io.sockets.sockets.values()) {
        if (getUserByToken(socket.data.token)?.username === req.body.username) socket.emit('room_invited', { roomId: room.id, roomName: room.name });
    }
    res.json({ success: true, message: '邀请已发送，用户已获得房间访问权限' });
});
function removeRoomConnections(room, reason) {
    for (const user of [...room.users]) {
        const socket = io.sockets.sockets.get(user.socketId);
        if (!socket) continue;
        socket.leave(roomChannel(room.id));
        if (user.currentRoom === room.id) {
            socket.emit('kicked_from_room', { roomId: room.id, roomName: room.name, reason });
            switchRoom(socket, user, rooms.get('default'));
        }
    }
    room.users = [];
}
app.delete('/api/rooms/:roomId', adminMiddleware, managedRoom, (req, res) => {
    if (req.room.id === 'default') return res.status(400).json({ error: '不能删除默认房间' });
    const force = req.query.force === 'true';
    if (req.room.users.length && !force) return res.status(400).json({ error: '房间中还有用户，无法删除', userCount: req.room.users.length });
    const kickedUsers = req.room.users.length;
    removeRoomConnections(req.room, '房间已被管理员删除');
    rooms.delete(req.room.id);
    messages.delete(req.room.id);
    saveMessages();
    saveRooms();
    broadcastRoomList();
    res.json({ success: true, message: '房间已删除', force, kickedUsers });
});
app.post('/api/rooms/:roomId/kick-users', adminMiddleware, managedRoom, (req, res) => {
    if (req.room.id === 'default') return res.status(400).json({ error: '不能移除默认群成员' });
    const kickedCount = req.room.users.length;
    removeRoomConnections(req.room, '房间成员已被管理员移除');
    req.room.members = [req.room.createdBy].filter(Boolean);
    req.room.memberIds = [accountId(req.room.createdBy)].filter(Boolean);
    saveRooms();
    syncRoomSubscriptions();
    res.json({ success: true, message: '已移除受邀成员', kickedCount });
});
app.get('/api/rooms', authMiddleware, (req, res) => {
    if (req.query.manage === '1' && !isAdmin(req.auth)) return res.status(403).json({ error: '需要管理员权限' });
    res.json(visibleRooms(req.auth, req.query.manage === '1'));
});

const socialChanged = require('./social')({ app, authMiddleware, adminMiddleware, userStore, social, saveSocial,
    rooms, messages, saveRooms, saveMessages, accountById, areFriends, canAccessRoom, canManageRoom,
    roomInfo, syncRoomSubscriptions, io, users, roomChannel, config, notifyJiyu });
function notifyJiyuRoom(room, senderId, message) {
    if (!config.jiyuEnabled || !room) return;
    const recipients = room.memberIds.filter(id => id !== senderId && ![...users.values()].some(user =>
        user.id === id && user.currentRoom === room.id && user.isViewing));
    const ips = recipients.map(id => accountById(id)?.boundIp).filter(ip => isIPv4(ip));
    if (!ips.length) return;
    notifyJiyu(ips, config.jiyuPort, message, (error, result) => {
        if (error) console.error('极域 UDP 发送失败:', result);
    });
}

// Socket.IO处理 - 现在 io 已经初始化了
io.on('connection', (socket) => {
    const clientIP = socket.handshake.address;
    socket.on('client_state', data => {
        const user = socketUser(socket);
        if (user && data && typeof data.isViewing === 'boolean') user.isViewing = data.isViewing;
    });
    console.log(`用户连接: ${socket.id} from ${clientIP}`);

    socket.on('create_room', (data = {}) => {
        const user = socketUser(socket);
        const error = roomCreationError(user, data);
        if (error) return socket.emit('error', error);
        const room = createRoom(data.roomId, data.roomName, data.isPublic !== false, user.username);
        socket.emit('room_created', { roomId: room.id, roomName: room.name });
    });
    // Keep legacy clients from bypassing the same management policy over WebSocket.
    socket.on('delete_room', (data) => {
        const { roomId } = data || {};
        const user = socketUser(socket);
        const room = rooms.get(roomId);
        if (!canManageRoom(user, room)) return socket.emit('error', '需要房间管理权限');
        if (room.id === 'default') return socket.emit('error', '不能删除默认房间');
        if (room.users.length) return socket.emit('error', '请在管理面板中强制删除有用户的房间');
        rooms.delete(room.id);
        messages.delete(room.id);
        saveMessages();
        saveRooms();
        broadcastRoomList();
        socket.emit('room_deleted', { roomId: room.id, roomName: room.name });
    });
    socket.on('join_room', (data) => {
        const { roomId } = data || {};
        const user = socketUser(socket);
        const room = rooms.get(roomId);
        if (!canAccessRoom(user, room)) return socket.emit('error', '房间不存在或未获邀请');
        switchRoom(socket, user, room);
    });
    socket.on('join', (data) => {
        const { token = requestToken({ headers: socket.request.headers }), roomId = 'default' } = data || {};
        const auth = getUserByToken(token);
        if (!auth) return socket.emit('error', '登录已过期，请重新登录');
        const ipError = accountIpError(auth, clientIP);
        if (ipError) return socket.emit('error', ipError);
        const room = rooms.get(roomId);
        if (!canAccessRoom(auth, room)) return socket.emit('error', '房间不存在或未获邀请');
        clearTimeout(socket.data.expiryTimer);
        socket.data.token = token;
        socket.data.expiryTimer = setTimeout(() => {
            socket.emit('error', '登录已过期，请重新登录');
            socket.disconnect(true);
        }, Math.max(0, userStore.tokens[token].expiresAt - Date.now()));
        const user = { id: auth.id, isViewing: false, username: auth.username, role: auth.role,
            socketId: socket.id, joinTime: Date.now(), ip: clientIP.replace('::ffff:', ''),
            isMuted: mutedIPs.has(clientIP.replace('::ffff:', '')), currentRoom: roomId };
        users.set(socket.id, user);
        syncRoomSubscriptions();
        socket.emit('account_changed', auth);
        switchRoom(socket, user, room);
        socialChanged();
        if (!cancelPendingLeave(user.username)) broadcastUserJoined(socket, roomId, user.username, 'join');
    });

    socket.on('send_message', (data) => {
        const { content, roomId = 'default' } = data || {};
        const user = socketUser(socket);
        
        if (!user) {
            socket.emit('error', '请先加入聊天室');
            return;
        }
        
        if (!canSendRoom(user, rooms.get(roomId))) return socket.emit('error', '无权访问该房间');
        if (user.isMuted) {
            socket.emit('error', '你已被禁言，无法发送消息');
            return;
        }
        
        if (typeof content !== 'string' || !content.trim() || content.length > 20000) return;
        
        // 处理 Markdown
        const messageId = generateId();
        const isMarkdown = true;
        const processedContent = processMarkdown(content, messageId);
        
        const message = {
            id: messageId,
            type: 'text',
            username: user.username, userId: user.id,
            content,
            processedContent: processedContent,
            isMarkdown: isMarkdown,
            timestamp: Date.now(),
            room: roomId,
        };
        
        const roomMessages = messages.get(roomId) || [];
        roomMessages.push(message);
        saveMessages();
        io.to(roomChannel(roomId)).emit('message', message);
        notifyJiyuRoom(rooms.get(roomId), user.id, message);
        broadcastRoomList();
        
        console.log(`消息 [${roomId}]: ${user.username} (IP: ${user.ip}): ${content}`);
    });

    // 文件消息：客户端上传成功后通知服务器广播
    socket.on('send_file', (data) => {
        const { storedName, roomId = 'default' } = data || {};
        const user = socketUser(socket);

        if (!user) {
            socket.emit('error', '请先加入聊天室');
            return;
        }
        if (!canSendRoom(user, rooms.get(roomId))) return socket.emit('error', '无权访问该房间');
        if (user.isMuted) {
            socket.emit('error', '你已被禁言，无法发送文件');
            return;
        }
        if (!storedName || !rooms.has(roomId)) {
            socket.emit('error', '文件消息无效');
            return;
        }

        const record = fileStore.files.find(f => f.storedName === storedName);
        if (!record) {
            socket.emit('error', '文件不存在或已过期');
            return;
        }
        if (record.expired) {
            socket.emit('error', '文件已过期');
            return;
        }
        if (record.roomId !== roomId || record.uploader !== user.username) return socket.emit('error', '不能转发其他用户或其他房间的文件');

        const message = {
            id: generateId(),
            type: 'file',
            username: user.username, userId: user.id,
            name: record.name,
            size: record.size,
            mimeType: record.mimeType,
            fileUrl: `/uploads/${encodeURIComponent(record.storedName)}`,
            storedName: record.storedName,
            isImage: String(record.mimeType || '').startsWith('image/'),
            timestamp: Date.now(),
            room: roomId,
        };

        const roomMessages = messages.get(roomId) || [];
        roomMessages.push(message);
        saveMessages();
        io.to(roomChannel(roomId)).emit('message', message);
        notifyJiyuRoom(rooms.get(roomId), user.id, message);
        broadcastRoomList();
        saveFiles();

        console.log(`文件消息 [${roomId}]: ${record.name} by ${user.username}`);
    });

    socket.on('typing', (data) => {
        const { isTyping, roomId = 'default' } = data || {};
        const user = socketUser(socket);
        
        if (user && !user.isMuted && canSendRoom(user, rooms.get(roomId))) {
            socket.to(roomChannel(roomId)).emit('user_typing', {
                username: user.username, userId: user.id,
                isTyping, room: roomId
            });
        }
    });

    socket.on('get_rooms', () => {
        broadcastRoomList();
    });

    socket.on('disconnect', () => {
        clearTimeout(socket.data.expiryTimer);
        const user = users.get(socket.id);
        if (user) {
            const leaveRoom = user.currentRoom;
            // 从所有房间移除用户
            rooms.forEach((room, roomId) => {
                const userIndex = room.users.findIndex(u => u.socketId === socket.id);
                if (userIndex > -1) {
                    room.users.splice(userIndex, 1);
                    updateUserList(roomId);
                }
            });

            users.delete(socket.id);
            broadcastRoomList();
            socialChanged();

            // 若该账号已无其他在线连接，则延迟广播离开（可被刷新重连取消）
            const stillOnline = Array.from(users.values()).some(u => u.username === user.username);
            if (!stillOnline && leaveRoom && rooms.has(leaveRoom)) {
                scheduleUserLeft(leaveRoom, user.username);
            }

            console.log(`用户断开连接: ${user.username} (IP: ${user.ip})`);
        }
    });
});
// 启动服务器
const PORT = process.env.PORT || config.port || 3001;

// 用系统默认浏览器打开指定地址（供一键启动脚本使用）
function openBrowser(url) {
    const cmd = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`;
    exec(cmd, (err) => {
        if (err) console.log(`⚠️  未能自动打开浏览器，请手动访问: ${url}`);
    });
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('🚀 BetterLanTalk 内网聊天室服务器已启动 v1.1.1');
    console.log(`📍 本地访问: http://localhost:${PORT}`);
    console.log(`🌐 内网访问: http://${localIP}:${PORT}`);
    console.log(`💬 聊天室: http://${localIP}:${PORT}/`);
    console.log(`📎 文件传输: 单文件上限 ${config.maxFileMB}MB / 目录总量 ${config.maxUploadsMB}MB（管理面板可调）`);
    console.log('================================');
    console.log('按 Ctrl+C 停止服务器');

    // 由一键启动脚本设置该变量时，用本机内网地址自动打开浏览器
    if (process.env.LANTALK_OPEN_BROWSER === '1') {
        const url = `http://${localIP}:${PORT}/`;
        console.log(`🖥️  正在打开浏览器: ${url}`);
        openBrowser(url);
    }
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    process.exit(0);
});
