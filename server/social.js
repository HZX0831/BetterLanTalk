// Social data uses immutable account IDs; usernames remain display labels.
module.exports = function attachSocial({ app, authMiddleware, adminMiddleware, userStore, social, saveSocial,
    rooms, messages, saveRooms, saveMessages, accountById, areFriends, canAccessRoom, canManageRoom,
    roomInfo, syncRoomSubscriptions, io, users, roomChannel, config, notifyJiyu }) {
    const publicUser = account => ({ id: account.id, username: account.username,
        online: [...users.values()].some(user => user.id === account.id) });
    function socialInfo(account) {
        return {
            friends: social.friends.filter(pair => pair.includes(account.id)).map(pair => accountById(pair.find(id => id !== account.id)))
                .filter(Boolean).map(publicUser),
            requests: social.requests.filter(request => request.status === 'pending' && [request.from, request.to].includes(account.id))
                .map(request => ({ ...request, fromUser: accountById(request.from)?.username || '已删除用户', toUser: accountById(request.to)?.username || '已删除用户' }))
        };
    }
    function socialChanged() {
        for (const socket of io.sockets.sockets.values()) {
            const user = users.get(socket.id);
            if (user) socket.emit('social_changed', socialInfo(user));
        }
    }
    function directRoom(a, b) {
        let room = [...rooms.values()].find(room => room.kind === 'direct' && room.memberIds.includes(a) && room.memberIds.includes(b));
        if (!room) {
            room = { id: 'dm-' + require('crypto').randomUUID(), name: '', kind: 'direct', isPublic: false,
                createdBy: '', members: [], memberIds: [a, b], users: [], created: Date.now() };
            rooms.set(room.id, room); messages.set(room.id, []);
            saveRooms(); saveMessages();
        }
        return room;
    }
    app.get('/api/social', authMiddleware, (req, res) => res.json(socialInfo(req.auth)));
    app.get('/api/people', authMiddleware, (req, res) => {
        const q = String(req.query.q || '').trim().toLowerCase();
        if (!q) return res.json([]);
        res.json(userStore.users.filter(account => account.id !== req.auth.id && account.username.toLowerCase().includes(q)).slice(0, 30)
            .map(account => ({ ...publicUser(account), isFriend: areFriends(req.auth.id, account.id) })));
    });
    app.post('/api/friend-requests', authMiddleware, (req, res) => {
        const target = accountById(req.body.userId);
        if (!target) return res.status(404).json({ error: '用户不存在' });
        if (target.id === req.auth.id) return res.status(400).json({ error: '不能添加自己' });
        if (areFriends(req.auth.id, target.id)) return res.status(409).json({ error: '已经是好友' });
        if (social.requests.some(request => request.status === 'pending' &&
            [request.from, request.to].includes(req.auth.id) && [request.from, request.to].includes(target.id)))
            return res.status(409).json({ error: '已有待处理申请，请前往好友申请查看' });
        const request = { id: require('crypto').randomUUID(), from: req.auth.id, to: target.id, status: 'pending', createdAt: Date.now() };
        social.requests.push(request); saveSocial(); socialChanged(); res.json({ success: true, request });
    });
    app.put('/api/friend-requests/:id', authMiddleware, (req, res) => {
        const request = social.requests.find(request => request.id === req.params.id);
        if (!request) return res.status(404).json({ error: '申请不存在' });
        const action = req.body.action;
        if (!['accept', 'reject', 'withdraw'].includes(action)) return res.status(400).json({ error: '申请操作无效' });
        if ((action === 'withdraw' ? request.from : request.to) !== req.auth.id)
            return res.status(403).json({ error: '无权处理此申请' });
        if (request.status !== 'pending') return res.status(409).json({ error: '申请已处理' });
        let room;
        if (action === 'accept') {
            if (!accountById(request.from) || !accountById(request.to)) return res.status(404).json({ error: '账号已不存在' });
            if (!areFriends(request.from, request.to)) social.friends.push([request.from, request.to]);
            room = directRoom(request.from, request.to);
        }
        request.status = action; request.updatedAt = Date.now(); saveSocial();
        syncRoomSubscriptions(); socialChanged();
        res.json({ success: true, ...(room ? { room: roomInfo(room, req.auth) } : {}) });
    });
    app.delete('/api/friends/:id', authMiddleware, (req, res) => {
        if (!areFriends(req.auth.id, req.params.id)) return res.status(404).json({ error: '好友不存在' });
        social.friends = social.friends.filter(pair => !(pair.includes(req.auth.id) && pair.includes(req.params.id)));
        saveSocial(); syncRoomSubscriptions(); socialChanged(); res.json({ success: true });
    });
    app.post('/api/direct-chats', authMiddleware, (req, res) => {
        if (!areFriends(req.auth.id, req.body.userId)) return res.status(403).json({ error: '仅好友之间可建立私聊' });
        const room = directRoom(req.auth.id, req.body.userId);
        syncRoomSubscriptions(); res.json({ room: roomInfo(room, req.auth) });
    });
    app.get('/api/public-rooms', authMiddleware, (req, res) => {
        const q = String(req.query.q || '').toLowerCase();
        res.json([...rooms.values()].filter(room => room.kind !== 'direct' && room.isPublic && room.name.toLowerCase().includes(q))
            .map(room => ({ id: room.id, name: room.name, joined: canAccessRoom(req.auth, room), memberCount: room.memberIds.length })));
    });
    app.post('/api/rooms/:roomId/join', authMiddleware, (req, res) => {
        const room = rooms.get(req.params.roomId);
        if (!room || room.kind === 'direct' || !room.isPublic) return res.status(403).json({ error: '仅公开群可主动加入，私有群需要邀请' });
        if (!room.memberIds.includes(req.auth.id)) room.memberIds.push(req.auth.id);
        saveRooms(); syncRoomSubscriptions(); res.json({ room: roomInfo(room, req.auth) });
    });
    app.post('/api/rooms/:roomId/leave', authMiddleware, (req, res) => {
        const room = rooms.get(req.params.roomId);
        if (!canAccessRoom(req.auth, room) || room.kind === 'direct') return res.status(403).json({ error: '无权退出该群' });
        if (room.id === 'default') return res.status(400).json({ error: '不能退出默认群' });
        if (room.createdBy === req.auth.username) return res.status(400).json({ error: '群创建者请通过管理页删除群' });
        room.memberIds = room.memberIds.filter(id => id !== req.auth.id);
        saveRooms(); syncRoomSubscriptions(); res.json({ success: true });
    });
    app.delete('/api/rooms/:roomId/members/:userId', adminMiddleware, (req, res) => {
        const room = rooms.get(req.params.roomId);
        if (!canManageRoom(req.auth, room)) return res.status(403).json({ error: '需要群管理权限' });
        if (room.id === 'default' || accountById(req.params.userId)?.username === room.createdBy)
            return res.status(400).json({ error: '不能移除默认群成员或群创建者' });
        room.memberIds = room.memberIds.filter(id => id !== req.params.userId);
        saveRooms(); syncRoomSubscriptions(); res.json({ success: true });
    });
    app.get('/api/rooms/:roomId/members', authMiddleware, (req, res) => {
        const room = rooms.get(req.params.roomId);
        if (!canAccessRoom(req.auth, room)) return res.status(403).json({ error: '无权查看该会话' });
        res.json(room.memberIds.map(accountById).filter(Boolean).map(publicUser));
    });
    app.get('/api/rooms/:roomId/messages', authMiddleware, (req, res) => {
        const room = rooms.get(req.params.roomId);
        if (!canAccessRoom(req.auth, room)) return res.status(403).json({ error: '无权查看该会话' });
        const history = messages.get(room.id) || [];
        const index = req.query.beforeId ? history.findIndex(message => message.id === req.query.beforeId) : history.length;
        if (index < 0) return res.status(400).json({ error: '历史游标无效' });
        res.json(history.slice(0, index).slice(-100));
    });
    // Notification destinations are the account's fixed login IP, exposed read-only.
    app.get('/api/jiyu/devices', adminMiddleware, (req, res) => res.json(userStore.users.map(account => ({
        userId: account.id, username: account.username, ip: account.boundIp || ''
    }))));
    app.post('/api/jiyu/test', adminMiddleware, (req, res) => {
        const account = req.body.userId ? accountById(req.body.userId) : userStore.users.find(account => account.boundIp === req.body.ip);
        if (!account?.boundIp) return res.status(400).json({ error: '目标账号尚未关联设备 IP' });
        notifyJiyu([account.boundIp], config.jiyuPort, { username: req.auth.username, type: 'text' }, (error, result) => {
            res.status(error ? 502 : 200).json({ success: !error, ...result,
                message: error ? 'UDP 发送失败' : result.skipped ? '设备处于 20 秒冷却期，本次提醒已忽略' : 'UDP 已发送；是否显示弹窗需在目标设备确认' });
        });
    });
    return socialChanged;
};
