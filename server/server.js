const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');

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

// 获取本机IP地址
function getLocalIP() {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const interfaceInfo of interfaces[name]) {
                if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
                    if (name.includes('Wi-Fi') || name.includes('WLAN') || name.includes('Ethernet') || name.includes('本地连接')) {
                        return interfaceInfo.address;
                    }
                }
            }
        }
        for (const name of Object.keys(interfaces)) {
            for (const interfaceInfo of interfaces[name]) {
                if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
                    return interfaceInfo.address;
                }
            }
        }
    } catch (error) {
        console.log('获取IP地址失败:', error);
    }
    return '127.0.0.1';
}

const app = express();
const server = http.createServer(app);
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
const localIP = getLocalIP();

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
app.use('/admin', express.static('../admin'));

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
    res.json({
        name: '内网聊天室服务器',
        version: '1.2.0',
        status: 'running',
        serverIP: localIP,
        port: 3001,
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

app.get('/api/users', (req, res) => {
    const userList = Array.from(users.values()).map(user => ({
        id: user.id,
        username: user.username,
        ip: user.ip,
        isMuted: user.isMuted,
        joinTime: user.joinTime
    }));
    res.json(userList);
});

app.post('/api/mute-ip', (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP地址不能为空' });

    mutedIPs.add(ip);
    users.forEach(user => {
        if (user.ip === ip) user.isMuted = true;
    });

    console.log(`IP ${ip} 已被禁言`);
    res.json({ success: true, message: `IP ${ip} 已被禁言` });
});

app.post('/api/unmute-ip', (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP地址不能为空' });

    mutedIPs.delete(ip);
    users.forEach(user => {
        if (user.ip === ip) user.isMuted = false;
    });

    console.log(`IP ${ip} 已解除禁言`);
    res.json({ success: true, message: `IP ${ip} 已解除禁言` });
});

app.get('/api/muted-ips', (req, res) => {
    res.json(Array.from(mutedIPs));
});

app.post('/api/broadcast', (req, res) => {
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
app.post('/api/rooms', (req, res) => {
    const { roomId, roomName, adminToken } = req.body; // 可以添加管理员令牌绕过检查
    
    console.log('API创建房间请求:', roomId, 'adminToken:', adminToken);
    
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
    
    // 如果是管理员操作（通过管理面板），允许创建房间
    const isAdminRequest = adminToken === 'admin123'; // 简单的管理员令牌验证
    
    if (!isAdminRequest) {
        // 检查请求IP是否被禁言
        const clientIP = req.ip || req.connection.remoteAddress;
        console.log('客户端IP:', clientIP, '禁言列表:', Array.from(mutedIPs));
        
        if (mutedIPs.has(clientIP)) {
            return res.status(403).json({ error: '你的IP已被禁言，无法创建房间' });
        }
        
        // 还可以检查用户是否在线并被禁言
        let isUserMuted = false;
        users.forEach(user => {
            if (user.ip === clientIP && user.isMuted) {
                isUserMuted = true;
            }
        });
        
        if (isUserMuted) {
            return res.status(403).json({ error: '你已被禁言，无法创建房间' });
        }
    }
    
    // 创建新房间
    const room = createRoom(roomId, roomName || roomId);
    
    console.log(`通过API创建房间: ${room.name} (${roomId}) ${isAdminRequest ? '[管理员操作]' : ''}`);
    
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
app.delete('/api/rooms/:roomId', (req, res) => {
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
                
                // 发送加入默认房间的消息
                const joinMessage = {
                    id: generateId(),
                    type: 'join',
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
app.post('/api/rooms/:roomId/kick-users', (req, res) => {
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
            
            // 发送离开消息
            const leaveMessage = {
                id: generateId(),
                type: 'leave',
                username: '系统',
                content: `${user.username} 离开了房间`,
                timestamp: Date.now(),
                room: user.currentRoom,
                userIP: user.ip
            };
            
            messages.get(user.currentRoom)?.push(leaveMessage);
            socket.to(user.currentRoom).emit('message', leaveMessage);
        }
        
        // 加入新房间
        const room = rooms.get(roomId);
        user.currentRoom = roomId;
        
        socket.join(roomId);
        
        // 如果用户不在房间用户列表中，则添加
        if (!room.users.find(u => u.socketId === socket.id)) {
            room.users.push(user);
        }
        
        // 发送加入消息
        const joinMessage = {
            id: generateId(),
            type: 'join',
            username: '系统',
            content: `${user.username} 加入了房间`,
            timestamp: Date.now(),
            room: roomId,
            userIP: user.ip
        };
        
        messages.get(roomId)?.push(joinMessage);
        socket.emit('message', joinMessage);
        socket.to(roomId).emit('message', joinMessage);
        
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
        const { username, roomId = 'default' } = data;
        
        if (!username || username.length < 2 || username.length > 20) {
            socket.emit('error', '用户名长度应为2-20个字符');
            return;
        }
        
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
        
        const joinMessage = {
            id: generateId(),
            type: 'join',
            username: '系统',
            content: `${username} (IP: ${clientIP}) 加入了聊天室${isIPMuted ? ' [已被禁言]' : ''}`,
            timestamp: Date.now(),
            room: roomId,
            userIP: clientIP
        };
        
        messages.get(roomId)?.push(joinMessage);
        
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
        
        socket.emit('message', joinMessage);
        socket.emit('message_history', (messages.get(roomId) || []).slice(-50));
        socket.to(roomId).emit('message', joinMessage);
        
        updateUserList(roomId);
        broadcastRoomList();
        
        console.log(`用户 ${username} (IP: ${clientIP}) 加入房间 ${roomId} ${isIPMuted ? '[禁言状态]' : ''}`);
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
            // 从所有房间移除用户
            rooms.forEach((room, roomId) => {
                const userIndex = room.users.findIndex(u => u.socketId === socket.id);
                if (userIndex > -1) {
                    room.users.splice(userIndex, 1);
                    
                    // 只在用户当前房间发送离开消息
                    if (roomId === user.currentRoom) {
                        const leaveMessage = {
                            id: generateId(),
                            type: 'leave',
                            username: '系统',
                            content: `${user.username} (IP: ${user.ip}) 离开了聊天室`,
                            timestamp: Date.now(),
                            room: roomId,
                            userIP: user.ip
                        };
                        
                        messages.get(roomId)?.push(leaveMessage);
                        socket.to(roomId).emit('message', leaveMessage);
                        updateUserList(roomId);
                    }
                }
            });
            
            users.delete(socket.id);
            broadcastRoomList();
            console.log(`用户断开连接: ${user.username} (IP: ${user.ip})`);
        }
    });
});
// 启动服务器
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('🚀 内网聊天室服务器已启动 v1.2.1');
    console.log(`📍 本地访问: http://localhost:${PORT}`);
    console.log(`🌐 内网访问: http://${localIP}:${PORT}`);
    console.log(`💬 聊天室: http://${localIP}:${PORT}/client/index.html`);
    console.log(`🛡️  管理面板: http://${localIP}:${PORT}/admin/admin.html`);
    console.log('📝 新功能: 支持多房间和Markdown');
    console.log('================================');
    console.log('按 Ctrl+C 停止服务器');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    process.exit(0);
});