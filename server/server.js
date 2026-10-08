const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

// Markdown 处理模块
const marked = require('marked');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// 配置 marked
marked.setOptions({
  highlight: function(code, lang) {
    return code;
  },
  breaks: true,
  gfm: true,
  tables: true,
  sanitize: false
});

// Markdown 处理函数
function processMarkdown(content) {
  try {
    const rawHtml = marked.parse(content);
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 
        'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'span', 'div'
      ],
      ALLOWED_ATTR: [
        'href', 'target', 'rel', 'src', 'alt', 'title', 'class'
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });
    return cleanHtml;
  } catch (error) {
    console.error('Markdown processing error:', error);
    return DOMPurify.sanitize(content);
  }
}

// 检查是否包含Markdown语法
function containsMarkdown(text) {
  const markdownPatterns = [
    /\*\*(.*?)\*\*/,
    /\*(.*?)\*/,
    /__(.*?)__/,
    /~~(.*?)~~/,
    /`(.*?)`/,
    /```([\s\S]*?)```/m,
    /\[(.*?)\]\((.*?)\)/,
    /!\[(.*?)\]\((.*?)\)/,
    /^#+\s+.+/m,
    /^>\s+.+/m,
    /^-\s+.+/m,
    /^\d+\.\s+.+/m,
    /\|.*\|/
  ];
  return markdownPatterns.some(pattern => pattern.test(text));
}

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
const UPLOADS_DIR = path.join(__dirname, 'uploads');

function loadJSON(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
}
function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let config = loadJSON(CONFIG_FILE, null) || {};
if (!config.port || isNaN(config.port)) config.port = 3001;
config.port = Number(config.port);
if (!config.maxFileMB || isNaN(config.maxFileMB)) config.maxFileMB = 5120;   // 单文件上限 5GB
if (!config.maxUploadsMB || isNaN(config.maxUploadsMB)) config.maxUploadsMB = 20480; // 上传目录总上限 20GB
config.maxFileMB = Number(config.maxFileMB);
config.maxUploadsMB = Number(config.maxUploadsMB);
if (typeof config.serverIP !== 'string') config.serverIP = '';   // 手动指定的对外IP，留空则自动检测
saveJSON(CONFIG_FILE, {
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
if (!Array.isArray(userStore.users)) userStore.users = [];
if (typeof userStore.tokens !== 'object' || !userStore.tokens) userStore.tokens = {};

function saveUsers() { saveJSON(USERS_FILE, userStore); }

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function addUser(username, password, role, registeredIp) {
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        role,
        registeredIp: registeredIp || '',
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

function getUserByToken(token) {
    if (!token) return null;
    const t = userStore.tokens[token];
    if (!t) return null;
    if (t.expiresAt < Date.now()) {
        delete userStore.tokens[token];
        saveUsers();
        return null;
    }
    return t;
}

function clientIpOf(req) {
    return (req.socket && req.socket.remoteAddress || '').replace('::ffff:', '');
}

function authMiddleware(req, res, next) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: '未登录' });
    const u = getUserByToken(m[1]);
    if (!u) return res.status(401).json({ error: '登录已过期，请重新登录' });
    req.auth = u;
    next();
}

function adminMiddleware(req, res, next) {
    authMiddleware(req, res, () => {
        if (req.auth.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
        next();
    });
}

// 初始化：确保存在管理员账号
if (!userStore.users.some(u => u.role === 'admin')) {
    addUser('admin', 'admin123', 'admin', '');
    console.log('⚠️  已创建默认管理员账号 admin / admin123 ，请尽快登录修改密码');
}
saveUsers();

const io = new Server(server, {  // ← io 在这里初始化
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const users = new Map();
const rooms = new Map();
const messages = new Map();
const mutedIPs = new Set();
// 对外IP：优先使用配置中手动指定的，否则自动检测
let localIP = (config.serverIP && config.serverIP.trim()) || getLocalIP();

// 离开提示延迟（毫秒）：页面刷新时可被下一次 join 取消，避免刷屏
const LEAVE_DELAY = 8000;
const pendingLeaves = new Map(); // username -> { timer, roomId }

function broadcastUserJoined(socket, roomId, username, reason) {
    socket.to(roomId).emit('user_joined', { username, room: roomId, reason });
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
        io.to(roomId).emit('user_left', { username, room: roomId, reason: 'leave' });
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
                io.to(f.roomId).emit('message', msg);
                io.to(f.roomId).emit('file_expired', { storedName: f.storedName });
            }
        });
    }
    return removed;
}

// 启动时执行一次清理
cleanupUploads();

// 房间管理函数
function createRoom(roomId, roomName = null) {
    if (!rooms.has(roomId)) {
        const room = {
            id: roomId,
            name: roomName || roomId,
            users: [],
            created: Date.now(),
            isPublic: true
        };
        rooms.set(roomId, room);
        messages.set(roomId, []);
        console.log(`创建新房间: ${roomName || roomId}`);
        return room;
    }
    return rooms.get(roomId);
}

// 广播房间列表给所有客户端
function broadcastRoomList() {
    const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        userCount: room.users.length,
        created: room.created,
        isPublic: room.isPublic
    }));
    
    io.emit('room_list', roomList);
}

function updateUserList(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        io.to(roomId).emit('user_list', room.users.map(user => ({
            id: user.id,
            username: user.username,
            joinTime: user.joinTime,
            ip: user.ip,
            isMuted: user.isMuted
        })));
    }
}

// 中间件
app.use(cors());
app.use(express.json());
app.use('/client', express.static('../client'));
app.use('/uploads', express.static(UPLOADS_DIR));

// 创建默认房间
rooms.set('default', {
    id: 'default',
    name: '公共聊天室',
    users: [],
    created: Date.now(),
    isPublic: true
});
messages.set('default', []);

// API路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/chat', (req, res) => {
    res.redirect('/');
});

app.get('/admin', (req, res) => {
    res.redirect('/');
});

app.get('/api/status', (req, res) => {
    res.json({
        name: '内网聊天室服务器',
        version: '1.0.0',
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
    if (!username || username.length < 2 || username.length > 20) {
        return res.status(400).json({ error: '用户名长度应为2-20个字符' });
    }
    if (!password || password.length < 6) {
        return res.status(400).json({ error: '密码长度至少6位' });
    }
    if (userStore.users.some(u => u.username === username)) {
        return res.status(400).json({ error: '用户名已存在' });
    }
    const ip = clientIpOf(req);
    if (ip && userStore.users.some(u => u.registeredIp && u.registeredIp === ip)) {
        return res.status(403).json({ error: '该IP已注册过账号，每个IP仅限注册一个用户' });
    }
    addUser(username, password, 'user', ip);
    const token = createToken(username, 'user');
    console.log(`新用户注册: ${username} (IP: ${ip})`);
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
    const token = createToken(user.username, user.role);
    console.log(`用户登录: ${user.username} (${user.role})`);
    res.json({ success: true, token, username: user.username, role: user.role });
});

app.get('/api/me', authMiddleware, (req, res) => {
    const user = userStore.users.find(u => u.username === req.auth.username);
    res.json({ username: req.auth.username, role: user ? user.role : req.auth.role });
});

app.post('/api/logout', authMiddleware, (req, res) => {
    const h = req.headers.authorization || '';
    const token = h.replace(/^Bearer /, '');
    delete userStore.tokens[token];
    saveUsers();
    res.json({ success: true });
});

// 账号管理（仅管理员）
app.get('/api/accounts', adminMiddleware, (req, res) => {
    res.json(userStore.users.map(u => ({
        username: u.username,
        role: u.role,
        registeredIp: u.registeredIp,
        createdAt: u.createdAt
    })));
});

app.put('/api/users/:username', adminMiddleware, (req, res) => {
    const user = userStore.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const { newUsername, newPassword } = req.body;
    if (newUsername !== undefined) {
        if (newUsername.length < 2 || newUsername.length > 20) {
            return res.status(400).json({ error: '用户名长度应为2-20个字符' });
        }
        if (userStore.users.some(u => u.username === newUsername)) {
            return res.status(400).json({ error: '新用户名已被占用' });
        }
        Object.values(userStore.tokens).forEach(t => {
            if (t.username === user.username) t.username = newUsername;
        });
        user.username = newUsername;
    }
    if (newPassword !== undefined && newPassword !== '') {
        if (newPassword.length < 6) {
            return res.status(400).json({ error: '密码长度至少6位' });
        }
        user.salt = crypto.randomBytes(16).toString('hex');
        user.passwordHash = hashPassword(newPassword, user.salt);
    }
    saveUsers();
    console.log(`管理员修改账号: ${req.params.username} -> ${user.username}`);
    res.json({ success: true, message: '修改成功', user: { username: user.username, role: user.role } });
});

app.delete('/api/users/:username', adminMiddleware, (req, res) => {
    const user = userStore.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.username === req.auth.username) {
        return res.status(400).json({ error: '不能删除当前登录的账号' });
    }
    userStore.users = userStore.users.filter(u => u.username !== user.username);
    Object.keys(userStore.tokens).forEach(t => {
        if (userStore.tokens[t].username === user.username) delete userStore.tokens[t];
    });
    saveUsers();
    console.log(`管理员删除账号: ${user.username}`);
    res.json({ success: true, message: `用户 ${user.username} 已删除` });
});

// 服务器配置
app.get('/api/config', adminMiddleware, (req, res) => {
    res.json({
        port: config.port,
        maxFileMB: config.maxFileMB,
        maxUploadsMB: config.maxUploadsMB,
        serverIP: config.serverIP || '',
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
    const { port, maxFileMB, maxUploadsMB, serverIP } = req.body;
    const updated = [];

    if (port !== undefined) {
        const p = Number(port);
        if (!p || isNaN(p) || p < 1 || p > 65535) {
            return res.status(400).json({ error: '端口号应为1-65535之间的数字' });
        }
        config.port = p;
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
        config.serverIP = ip;
        localIP = ip || getLocalIP();
        updated.push(`对外IP ${localIP}`);
    }
    if (maxFileMB !== undefined) {
        const m = Number(maxFileMB);
        if (!m || isNaN(m) || m <= 0) {
            return res.status(400).json({ error: '单文件上限应为正整数(MB)' });
        }
        config.maxFileMB = m;
        updated.push(`单文件上限 ${m}MB`);
    }
    if (maxUploadsMB !== undefined) {
        const m = Number(maxUploadsMB);
        if (!m || isNaN(m) || m <= 0) {
            return res.status(400).json({ error: '上传目录总上限应为正整数(MB)' });
        }
        config.maxUploadsMB = m;
        updated.push(`上传目录总上限 ${m}MB`);
    }
    if (config.maxFileMB > config.maxUploadsMB) {
        return res.status(400).json({ error: '单文件上限不能大于上传目录总上限' });
    }

    saveJSON(CONFIG_FILE, {
        port: config.port,
        maxFileMB: config.maxFileMB,
        maxUploadsMB: config.maxUploadsMB,
        serverIP: config.serverIP
    });
    // 修改上限后立即按新上限清理一次
    cleanupUploads();
    res.json({
        success: true,
        message: updated.length ? '已更新: ' + updated.join('、') : '无改动',
        port: config.port,
        maxFileMB: config.maxFileMB,
        maxUploadsMB: config.maxUploadsMB,
        serverIP: config.serverIP,
        localIP
    });
});

// ============ 文件上传 API ============
app.post('/api/upload', authMiddleware, (req, res) => {
    const token = req.headers.authorization.replace(/^Bearer /, '');
    const ip = clientIpOf(req);

    // 被禁言的 IP 不允许上传
    if (mutedIPs.has(ip)) {
        return res.status(403).json({ error: '你的IP已被禁言，无法上传文件' });
    }

    const roomId = String(req.query.room || req.headers['x-room'] || 'default');
    if (!rooms.has(roomId)) {
        return res.status(400).json({ error: '目标房间不存在' });
    }

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

        const record = {
            storedName,
            name: safeName,
            size: received,
            mimeType,
            uploader: req.auth.username,
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
        username: '管理员',
        content: message,
        timestamp: Date.now()
    };

    rooms.forEach((room, roomId) => {
        messages.get(roomId)?.push(adminMessage);
    });

    io.emit('message', adminMessage);
    res.json({ success: true, message: '广播发送成功' });
});
// 创建房间API
app.post('/api/rooms', adminMiddleware, (req, res) => {
    const { roomId, roomName } = req.body;

    console.log('API创建房间请求:', roomId, 'by', req.auth.username);

    if (!roomId) {
        return res.status(400).json({ error: '房间ID不能为空' });
    }

    if (roomId.length < 2 || roomId.length > 20) {
        return res.status(400).json({ error: '房间ID长度应为2-20个字符' });
    }

    // 检查房间是否已存在
    if (rooms.has(roomId)) {
        return res.status(400).json({ error: '房间已存在' });
    }

    // 创建新房间
    const room = createRoom(roomId, roomName || roomId);
    
    console.log(`通过API创建房间: ${room.name} (${roomId}) by ${req.auth.username}`);
    
    // 广播房间列表更新
    broadcastRoomList();
    
    res.json({ 
        success: true, 
        message: `房间 "${room.name}" 创建成功`,
        room: {
            id: room.id,
            name: room.name,
            userCount: room.users.length,
            created: room.created
        }
    });
});

// 删除房间API
app.delete('/api/rooms/:roomId', adminMiddleware, (req, res) => {
    const { roomId } = req.params;
    const { force = false } = req.query;
    
    console.log('收到删除房间请求:', roomId, '强制模式:', force);
    
    if (!roomId) {
        return res.status(400).json({ error: '房间ID不能为空' });
    }
    
    // 不能删除默认房间
    if (roomId === 'default') {
        return res.status(400).json({ error: '不能删除默认房间' });
    }
    
    const room = rooms.get(roomId);
    if (!room) {
        return res.status(404).json({ error: '房间不存在' });
    }
    
    // 如果房间有用户且不是强制删除模式
    if (room.users.length > 0 && !force) {
        return res.status(400).json({ 
            error: '房间中还有用户，无法删除',
            userCount: room.users.length,
            users: room.users.map(u => u.username)
        });
    }
    
    // 强制删除：踢出所有用户
    if (room.users.length > 0 && force) {
        console.log(`强制删除房间: 踢出 ${room.users.length} 个用户`);
        
        // 向房间内所有用户发送被踢出通知
        room.users.forEach(user => {
            const kickMessage = {
                id: generateId(),
                type: 'admin',
                username: '系统',
                content: `房间 "${room.name}" 已被管理员删除，您已被移出房间`,
                timestamp: Date.now()
            };
            
            // 发送踢出消息
            io.to(user.socketId).emit('message', kickMessage);
            io.to(user.socketId).emit('room_deleted', {
                roomId: roomId,
                roomName: room.name,
                reason: '房间已被管理员删除'
            });
            
            // 将用户移回默认房间
            const userSocket = io.sockets.sockets.get(user.socketId);
            if (userSocket) {
                userSocket.leave(roomId);
                userSocket.join('default');
                
                // 更新用户当前房间
                user.currentRoom = 'default';
                
                // 发送默认房间的历史消息
                userSocket.emit('message_history', (messages.get('default') || []).slice(-50));
                
                // 发送加入默认房间的消息（系统操作提示，大消息框）
                const joinMessage = {
                    id: generateId(),
                    type: 'admin',
                    username: '系统',
                    content: `${user.username} 被移入默认房间`,
                    timestamp: Date.now(),
                    room: 'default'
                };
                
                messages.get('default')?.push(joinMessage);
                userSocket.emit('message', joinMessage);
                userSocket.to('default').emit('message', joinMessage);
            }
        });
        
        // 从房间中移除所有用户
        room.users = [];
    }
    
    // 删除房间
    rooms.delete(roomId);
    messages.delete(roomId);
    
    console.log(`管理员删除房间: ${room.name} (${roomId})${force ? ' [强制模式]' : ''}`);
    
    // 广播房间列表更新
    broadcastRoomList();
    
    res.json({ 
        success: true, 
        message: `房间 "${room.name}" 删除成功${force ? '（已踢出所有用户）' : ''}`,
        force: force,
        kickedUsers: force ? room.users.length : 0
    });
});

// 添加踢出用户API
app.post('/api/rooms/:roomId/kick-users', adminMiddleware, (req, res) => {
    const { roomId } = req.params;
    
    if (!roomId) {
        return res.status(400).json({ error: '房间ID不能为空' });
    }
    
    const room = rooms.get(roomId);
    if (!room) {
        return res.status(404).json({ error: '房间不存在' });
    }
    
    if (room.users.length === 0) {
        return res.status(400).json({ error: '房间中没有用户' });
    }
    
    console.log(`踢出房间 ${room.name} 的所有用户: ${room.users.length} 人`);
    
    // 踢出所有用户
    room.users.forEach(user => {
        const kickMessage = {
            id: generateId(),
            type: 'admin',
            username: '系统',
            content: `您已被管理员从房间 "${room.name}" 踢出`,
            timestamp: Date.now()
        };
        
        // 发送踢出消息
        io.to(user.socketId).emit('message', kickMessage);
        io.to(user.socketId).emit('kicked_from_room', {
            roomId: roomId,
            roomName: room.name,
            reason: '管理员操作'
        });
        
        // 将用户移回默认房间
        const userSocket = io.sockets.sockets.get(user.socketId);
        if (userSocket) {
            userSocket.leave(roomId);
            userSocket.join('default');
            user.currentRoom = 'default';
            
            // 发送默认房间的历史消息
            userSocket.emit('message_history', (messages.get('default') || []).slice(-50));
        }
    });
    
    // 清空房间用户列表
    const kickedCount = room.users.length;
    room.users = [];
    
    // 更新用户列表
    updateUserList('default');
    broadcastRoomList();
    
    res.json({ 
        success: true, 
        message: `已从房间 "${room.name}" 踢出 ${kickedCount} 个用户`,
        kickedCount: kickedCount
    });
});

app.get('/api/rooms', (req, res) => {
    const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        userCount: room.users.length,
        created: room.created
    }));
    res.json(roomList);
});

// Socket.IO处理 - 现在 io 已经初始化了
io.on('connection', (socket) => {
    const clientIP = socket.handshake.address;
    console.log(`用户连接: ${socket.id} from ${clientIP}`);

    socket.on('create_room', (data) => {
        const { roomId, roomName } = data;
        const user = users.get(socket.id);
        
        if (!user) {
            socket.emit('error', '请先加入聊天室');
            return;
        }
        
        if (!roomId || roomId.trim() === '') {
            socket.emit('error', '房间ID不能为空');
            return;
        }
        // 检查用户是否被禁言
        if (user.isMuted) {
            socket.emit('error', '你已被禁言，无法创建房间');
            return;
        }
        
        // 检查用户IP是否被禁言
        if (mutedIPs.has(user.ip)) {
            socket.emit('error', '你的IP已被禁言，无法创建房间');
            return;
        }
        // 检查房间是否已存在
        if (rooms.has(roomId)) {
            socket.emit('error', '房间已存在');
            return;
        }
        
        // 创建新房间
        createRoom(roomId, roomName || roomId);
        
        // 自动加入新房间
        socket.emit('room_created', { 
            roomId, 
            roomName: roomName || roomId 
        });
        
        // 更新所有客户端的房间列表
        broadcastRoomList();
        
        console.log(`用户 ${user.username} 创建房间: ${roomName || roomId}`);
    });
    // 添加删除房间事件
    socket.on('delete_room', (data) => {
        const { roomId } = data;
        const user = users.get(socket.id);
        
        if (!user) {
            socket.emit('error', '请先加入聊天室');
            return;
        }
        
        if (!roomId) {
            socket.emit('error', '房间ID不能为空');
            return;
        }
        
        // 不能删除默认房间
        if (roomId === 'default') {
            socket.emit('error', '不能删除默认房间');
            return;
        }
        
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', '房间不存在');
            return;
        }
        
        // 检查房间是否有用户
        if (room.users.length > 0) {
            socket.emit('error', '房间中还有用户，无法删除');
            return;
        }
        
        // 删除房间
        rooms.delete(roomId);
        messages.delete(roomId);
        
        console.log(`用户 ${user.username} 删除房间: ${room.name} (${roomId})`);
        
        // 广播房间列表更新
        broadcastRoomList();
        
        socket.emit('room_deleted', { 
            roomId, 
            roomName: room.name 
        });
    });

    // 继续其他Socket事件
    socket.on('join_room', (data) => {
        const { roomId } = data;
        const user = users.get(socket.id);
        
        if (!user) {
            socket.emit('error', '请先加入聊天室');
            return;
        }
        
        if (!rooms.has(roomId)) {
            socket.emit('error', '房间不存在');
            return;
        }
        
        // 离开当前房间
        if (user.currentRoom) {
            socket.leave(user.currentRoom);
            // 向右上角提示（不写入历史）
            socket.to(user.currentRoom).emit('user_left', {
                username: user.username,
                room: user.currentRoom,
                reason: 'switch'
            });
        }
        
        // 加入新房间
        const room = rooms.get(roomId);
        user.currentRoom = roomId;
        
        socket.join(roomId);
        
        // 如果用户不在房间用户列表中，则添加
        if (!room.users.find(u => u.socketId === socket.id)) {
            room.users.push(user);
        }
        
        // 向右上角提示（不写入历史）
        socket.to(roomId).emit('user_joined', {
            username: user.username,
            room: roomId,
            reason: 'switch'
        });
        
        // 发送新房间的历史消息
        socket.emit('message_history', (messages.get(roomId) || []).slice(-50));
        
        // 更新用户列表
        updateUserList(roomId);
        
        // 发送房间切换成功事件
        socket.emit('room_joined', {
            roomId: room.id,
            roomName: room.name,
            userCount: room.users.length
        });
        
        console.log(`用户 ${user.username} 加入房间: ${room.name}`);
    });

    socket.on('join', (data) => {
        const { token, roomId = 'default' } = data;

        const auth = getUserByToken(token);
        if (!auth) {
            socket.emit('error', '登录已过期，请重新登录');
            return;
        }
        const account = userStore.users.find(u => u.username === auth.username);
        const username = account ? account.username : auth.username;

        const isIPMuted = mutedIPs.has(clientIP);
        const user = {
            id: generateId(),
            username,
            socketId: socket.id,
            joinTime: Date.now(),
            ip: clientIP,
            isMuted: isIPMuted,  // 设置禁言状态
            currentRoom: roomId
        };
        
        users.set(socket.id, user);
        
        // 确保房间存在
        createRoom(roomId, roomId === 'default' ? '公共聊天室' : roomId);
        
        socket.join(roomId);
        
        const room = rooms.get(roomId);
        if (!room.users.find(u => u.socketId === socket.id)) {
            room.users.push(user);
        }

        // 若此前有待广播的离开（页面刷新场景），取消它并跳过本次加入提示
        const wasRefresh = cancelPendingLeave(username);
        
        // 如果被禁言，发送提示消息
        if (isIPMuted) {
            socket.emit('message', {
                id: generateId(),
                type: 'admin',
                username: '系统',
                content: '你的IP已被禁言，无法发送消息和创建房间',
                timestamp: Date.now()
            });
        }
        
        socket.emit('message_history', (messages.get(roomId) || []).slice(-50));
        if (!wasRefresh) {
            broadcastUserJoined(socket, roomId, username, 'join');
        }
        
        updateUserList(roomId);
        broadcastRoomList();
        
        console.log(`用户 ${username} (IP: ${clientIP}) 加入房间 ${roomId} ${isIPMuted ? '[禁言状态]' : ''}${wasRefresh ? ' [刷新重连，静默]' : ''}`);
    });

    socket.on('send_message', (data) => {
        const { content, roomId = 'default' } = data;
        const user = users.get(socket.id);
        
        if (!user) {
            socket.emit('error', '请先加入聊天室');
            return;
        }
        
        if (user.isMuted) {
            socket.emit('error', '你已被禁言，无法发送消息');
            return;
        }
        
        if (!content.trim()) return;
        
        // 处理 Markdown
        const isMarkdown = containsMarkdown(content);
        const processedContent = isMarkdown ? processMarkdown(content) : content;
        
        const message = {
            id: generateId(),
            type: 'text',
            username: user.username,
            content: content.trim(),
            processedContent: processedContent,
            isMarkdown: isMarkdown,
            timestamp: Date.now(),
            room: roomId,
            userIP: user.ip
        };
        
        const roomMessages = messages.get(roomId) || [];
        roomMessages.push(message);
        io.to(roomId).emit('message', message);
        
        console.log(`消息 [${roomId}]: ${user.username} (IP: ${user.ip}): ${content}`);
    });

    // 文件消息：客户端上传成功后通知服务器广播
    socket.on('send_file', (data) => {
        const { storedName, roomId = 'default' } = data || {};
        const user = users.get(socket.id);

        if (!user) {
            socket.emit('error', '请先加入聊天室');
            return;
        }
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
        record.roomId = roomId;

        const message = {
            id: generateId(),
            type: 'file',
            username: user.username,
            name: record.name,
            size: record.size,
            mimeType: record.mimeType,
            fileUrl: `/uploads/${encodeURIComponent(record.storedName)}`,
            storedName: record.storedName,
            isImage: String(record.mimeType || '').startsWith('image/'),
            timestamp: Date.now(),
            room: roomId,
            userIP: user.ip
        };

        const roomMessages = messages.get(roomId) || [];
        roomMessages.push(message);
        io.to(roomId).emit('message', message);
        saveFiles();

        console.log(`文件消息 [${roomId}]: ${record.name} by ${user.username}`);
    });

    socket.on('typing', (data) => {
        const { isTyping, roomId = 'default' } = data;
        const user = users.get(socket.id);
        
        if (user && !user.isMuted) {
            socket.to(roomId).emit('user_typing', {
                username: user.username,
                isTyping
            });
        }
    });

    socket.on('get_rooms', () => {
        broadcastRoomList();
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const leaveRoom = user.currentRoom;
            // 从所有房间移除用户
            rooms.forEach((room, roomId) => {
                const userIndex = room.users.findIndex(u => u.socketId === socket.id);
                if (userIndex > -1) {
                    room.users.splice(userIndex, 1);
                    if (roomId === leaveRoom) updateUserList(roomId);
                }
            });

            users.delete(socket.id);
            broadcastRoomList();

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
    console.log('🚀 BetterLanTalk 内网聊天室服务器已启动 v1.0.0');
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