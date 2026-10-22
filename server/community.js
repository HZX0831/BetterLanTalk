'use strict';
// Group permissions and message operations are shared by humans, sockets and Bots.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isIP } = require('net');
const policy = require('../client/message-policy');

module.exports = function communityService(ctx) {
    const { app, authMiddleware, adminMiddleware, userStore, saveUsers, social, saveSocial, rooms, messages,
        saveRooms, saveMessages, accountById, areFriends, canAccessRoom, canSendRoom, canManageRoom,
        roomInfo, syncRoomSubscriptions, io, users, roomChannel, DATA_DIR, loadJSON, saveJSON,
        processMarkdown, fileStore, notifyJiyuRoom } = ctx;
    const stateFile = path.join(DATA_DIR, 'community.json');
    const state = loadJSON(stateFile, { preferences: {}, invitations: [], applications: [], audit: [], bots: {} });
    for (const [key, fallback] of Object.entries({ preferences: {}, invitations: [], applications: [], audit: [], bots: {} })) state[key] ||= fallback;
    const save = () => saveJSON(stateFile, state);
    const uid = () => crypto.randomUUID();
    const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
    const text = (value, max, label, empty = true) => {
        if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(400, label + '格式无效');
        return value.trim();
    };
    const route = handler => (req, res, next) => {
        Promise.resolve().then(() => handler(req, res)).catch(error => {
            if (error.status) return res.status(error.status).json({ error: error.message, ...(error.details || {}) });
            next(error);
        });
    };
    const profile = account => account ? { id: account.id, username: account.username, kind: account.kind || 'human',
        avatar: account.avatar || '', about: account.about || '', online: [...users.values()].some(user => user.id === account.id) } : null;
    const role = (account, room) => {
        if (!canAccessRoom(account, room)) return 'member';
        if (room.id === 'default') return ['admin', 'superadmin'].includes(account.role) ? 'admin' : 'member';
        return room.ownerId === account.id ? 'owner' : (room.adminIds || []).includes(account.id) ? 'admin' : 'member';
    };
    function preferences(account, roomId) {
        return { nickname: '', remark: '', pinned: false, notificationMode: 'all', clearedThrough: '', opened: false,
            ...(state.preferences[account.id]?.rooms?.[roomId] || {}) };
    }
    function updatePreferences(account, roomId, patch) {
        state.preferences[account.id] ||= { rooms: {}, appearance: {} };
        state.preferences[account.id].rooms ||= {};
        state.preferences[account.id].rooms[roomId] = { ...preferences(account, roomId), ...patch }; save();
    }
    function history(account, room) {
        const list = messages.get(room.id) || [];
        const cutoff = preferences(account, room.id).clearedThrough;
        return cutoff ? list.slice(list.findIndex(item => item.id === cutoff) + 1) : list;
    }
    function group(id, account, access = true) {
        const room = rooms.get(id);
        if (!room || room.archived || room.kind === 'direct') fail(404, '群组不存在');
        if (access && !canAccessRoom(account, room)) fail(403, '无权访问该群组');
        return room;
    }
    function manager(account, room, ownerOnly = false) {
        if (!canManageRoom(account, room) || (ownerOnly && role(account, room) !== 'owner')) fail(403, '需要群管理权限');
    }
    const members = room => room.memberIds.map(accountById).filter(Boolean).map(account => ({ ...profile(account),
        nickname: preferences(account, room.id).nickname, groupRole: role(account, room) }));
    function info(room, account) {
        const joined = canAccessRoom(account, room);
        return { ...roomInfo(room, account), announcement: joined ? room.announcement || '' : '',
            joinMode: room.joinMode || 'open', questions: (room.questions || []).map(item => item.question),
            ownerId: room.ownerId || '', adminIds: room.adminIds || [], groupRole: role(account, room),
            avatar: room.avatar || '', settings: preferences(account, room.id) };
    }
    function notifyState() { syncRoomSubscriptions(); io.emit('community_changed'); }
    function botState(account) {
        return state.bots[account.id] ||= { nextId: 1, cursor: 0, updates: [], floor: 0 };
    }
    const waiting = new Map(), polling = new Set();
    function trimQueue(queue) {
        let removed;
        while (queue.updates.length && (queue.updates.length > 10000 || queue.updates[0].createdAt < Date.now() - 7 * 86400000)) removed = queue.updates.shift();
        if (removed) queue.floor = Math.max(queue.floor || 0, removed.updateId);
    }
    function botUpdate(account, type, data) {
        if (account.kind !== 'bot' || account.disabled) return;
        const queue = botState(account);
        queue.updates.push({ updateId: queue.nextId++, type, data, createdAt: Date.now() }); trimQueue(queue); save();
        waiting.get(account.id)?.();
    }
    function roomEvent(room, type, data) {
        for (const id of room.memberIds) { const account = accountById(id); if (account && (type !== 'join_request' || canManageRoom(account, room))) botUpdate(account, type, data); }
    }
    function announceChange(room) { saveRooms(); notifyState(); roomEvent(room, 'group_changed', { id: room.id, name: room.name, announcement: room.announcement || '', ownerId: room.ownerId || '', adminIds: room.adminIds || [] }); }
    function autoRequests() {
        let changed = false;
        for (const bot of userStore.users.filter(account => account.kind === 'bot' && !account.disabled)) {
            for (const human of userStore.users.filter(account => account.kind !== 'bot')) {
                if (areFriends(bot.id, human.id) || social.requests.some(item => item.from === bot.id && item.to === human.id)) continue;
                social.requests.push({ id: uid(), from: bot.id, to: human.id, status: 'pending', createdAt: Date.now(), automatic: true }); changed = true;
            }
        }
        if (changed) { saveSocial(); io.emit('community_changed'); }
    }
    function revoke(account) {
        for (const token of Object.keys(userStore.tokens)) if (userStore.tokens[token].username === account.username) delete userStore.tokens[token];
        saveUsers();
        for (const socket of io.sockets.sockets.values()) if (users.get(socket.id)?.id === account.id) {
            socket.emit('session_revoked', { reason: '账号绑定已调整，请重新登录' }); socket.disconnect(true);
        }
    }
    app.put('/api/accounts/:userId/ip-binding', adminMiddleware, route((req, res) => {
        const target = accountById(req.params.userId);
        if (!target) fail(404, '账号不存在');
        if (target.kind === 'bot') fail(400, 'Bot 无需绑定 IP');
        if (req.auth.role !== 'superadmin' && target.id !== req.auth.id && target.role !== 'user') fail(403, '不能调整其他管理员');
        let ip = req.body.ip;
        if (typeof ip === 'string') ip = ip.replace(/^::ffff:/i, '');
        if (ip !== null && (typeof ip !== 'string' || !isIP(ip))) fail(400, 'IP 地址无效');
        if (ip && userStore.users.some(account => account.id !== target.id && account.boundIp === ip)) fail(409, 'IP 已被其他账号占用');
        state.audit.push({ actorId: req.auth.id, targetId: target.id, action: 'ip-binding', oldIp: target.boundIp, newIp: ip || '', timestamp: Date.now() });
        target.boundIp = ip || ''; save(); revoke(target); res.json({ success: true, boundIp: target.boundIp });
    }));
    app.get('/api/accounts/audit/ip-binding', adminMiddleware, (req, res) => res.json(state.audit));

    app.get('/api/preferences', authMiddleware, (req, res) => res.json({ theme: 'light', accent: '#1687f8', preview: true, ...(state.preferences[req.auth.id]?.appearance || {}) }));
    app.put('/api/preferences', authMiddleware, route((req, res) => {
        const patch = {};
        if (req.body.theme !== undefined) { if (!['light', 'dark', 'system'].includes(req.body.theme)) fail(400, '主题无效'); patch.theme = req.body.theme; }
        if (req.body.accent !== undefined) { if (!/^#[\da-f]{6}$/i.test(req.body.accent)) fail(400, '颜色无效'); patch.accent = req.body.accent; }
        if (req.body.preview !== undefined) { if (typeof req.body.preview !== 'boolean') fail(400, '预览设置无效'); patch.preview = req.body.preview; }
        state.preferences[req.auth.id] ||= { rooms: {}, appearance: {} };
        Object.assign(state.preferences[req.auth.id].appearance ||= {}, patch); save(); res.json({ success: true });
    }));
    function setRoomSettings(req, res) {
        const room = rooms.get(req.params.roomId);
        if (!canAccessRoom(req.auth, room)) fail(403, '无权访问该会话');
        const patch = {};
        for (const key of ['nickname', 'remark']) if (req.body[key] !== undefined) patch[key] = text(req.body[key], 60, key);
        for (const key of ['pinned', 'opened']) if (req.body[key] !== undefined) { if (typeof req.body[key] !== 'boolean') fail(400, '设置无效'); patch[key] = req.body[key]; }
        if (req.body.notificationMode !== undefined) { if (!policy.modes.includes(req.body.notificationMode)) fail(400, '通知档位无效'); patch.notificationMode = req.body.notificationMode; }
        if (req.body.clear === true) patch.clearedThrough = (messages.get(room.id) || []).at(-1)?.id || '';
        updatePreferences(req.auth, room.id, patch); notifyState(); res.json({ settings: preferences(req.auth, room.id) });
    }
    app.put('/api/rooms/:roomId/settings', authMiddleware, route(setRoomSettings));

    function validateGroup(body, partial = false) {
        const patch = {};
        if (!partial || body.name !== undefined) patch.name = text(body.name, 50, '群名称', false);
        if (!partial || body.isPublic !== undefined) { if (typeof body.isPublic !== 'boolean') fail(400, '公开设置无效'); patch.isPublic = body.isPublic; }
        if (body.joinMode !== undefined) { if (!['open', 'answer', 'review'].includes(body.joinMode)) fail(400, '入群方式无效'); patch.joinMode = body.joinMode; }
        if (body.questions !== undefined) {
            if (!Array.isArray(body.questions) || body.questions.length > 8) fail(400, '最多设置 8 个问题');
            patch.questions = body.questions.map(item => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, '问题格式无效');
                return { question: text(item.question, 200, '问题', false), answer: text(item.answer ?? '', 200, '答案') };
            });
        }
        if (body.announcement !== undefined) patch.announcement = text(body.announcement, 5000, '公告');
        return patch;
    }
    app.get('/api/groups', authMiddleware, route((req, res) => {
        const q = String(req.query.q || '').toLowerCase();
        res.json([...rooms.values()].filter(room => room.kind !== 'direct' && !room.archived && room.isPublic && (room.name.toLowerCase().includes(q) || room.id.includes(q)))
            .map(room => ({ id: room.id, name: room.name, avatar: room.avatar || '', memberCount: room.memberIds.length, joined: canAccessRoom(req.auth, room),
                joinMode: room.joinMode || 'open', questions: (room.questions || []).map(item => item.question) })));
    }));
    app.post('/api/groups', authMiddleware, route((req, res) => {
        if (req.auth.kind === 'bot') fail(403, 'Bot 不能创建群组');
        const patch = validateGroup(req.body);
        const room = { ...patch, id: 'group-' + uid(), kind: 'group', ownerId: req.auth.id, adminIds: [], memberIds: [req.auth.id],
            members: [req.auth.username], createdBy: req.auth.username, created: Date.now(), users: [], groupVersion: 3 };
        if (room.joinMode === 'answer' && (!room.questions?.length || room.questions.some(item => !item.answer))) fail(400, '自动校验须设置问题和答案');
        rooms.set(room.id, room); messages.set(room.id, []); saveMessages(); announceChange(room); res.json({ room: info(room, req.auth) });
    }));
    app.get('/api/groups/:roomId', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); const data = info(room, req.auth);
        if (canManageRoom(req.auth, room)) data.managementQuestions = room.questions || [];
        res.json(data);
    }));
    app.put('/api/groups/:roomId', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); manager(req.auth, room);
        const patch = validateGroup(req.body, true);
        if (Object.keys(patch).some(key => key !== 'announcement') && room.id !== 'default') manager(req.auth, room, true);
        if (room.id === 'default' && Object.keys(patch).some(key => key !== 'announcement')) fail(400, '默认聊天室仅可编辑公告');
        const next = { ...room, ...patch };
        if (next.joinMode === 'answer' && (!next.questions?.length || next.questions.some(item => !item.answer))) fail(400, '自动校验须设置问题和答案');
        Object.assign(room, patch); announceChange(room); res.json({ room: info(room, req.auth) });
    }));
    function join(req, res) {
        const room = group(req.params.roomId, req.auth, false);
        if (canAccessRoom(req.auth, room)) return res.json({ room: info(room, req.auth) });
        const invitation = state.invitations.find(item => item.id === req.body.invitationId && item.roomId === room.id && item.to === req.auth.id && item.status === 'pending');
        if (invitation && (!room.memberIds.includes(invitation.from) || !areFriends(invitation.from, req.auth.id))) fail(403, '邀请已失效');
        if (!room.isPublic && !invitation) fail(403, '私有群需要有效好友邀请');
        const answers = req.body.answers || [];
        if (!Array.isArray(answers) || answers.length > 8 || answers.some(answer => typeof answer !== 'string' || answer.length > 500)) fail(400, '回答无效');
        if (room.joinMode === 'answer' && (room.questions || []).some((item, i) => item.answer.trim() !== (answers[i] || '').trim())) fail(400, '答案不正确');
        if (room.joinMode === 'review') {
            if ((room.questions || []).some((_, i) => !answers[i]?.trim())) fail(400, '请回答入群问题');
            let application = state.applications.find(item => item.roomId === room.id && item.userId === req.auth.id && item.status === 'pending');
            if (!application) { application = { id: uid(), roomId: room.id, userId: req.auth.id, answers, invitationId: invitation?.id, status: 'pending', createdAt: Date.now() }; state.applications.push(application); save(); roomEvent(room, 'join_request', application); }
            io.emit('community_changed'); return res.json({ pending: true, application });
        }
        room.memberIds.push(req.auth.id); if (invitation) invitation.status = 'accepted'; save(); announceChange(room); res.json({ room: info(room, req.auth) });
    }
    app.post('/api/groups/:roomId/join', authMiddleware, route(join));
    app.post('/api/groups/:roomId/invitations', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth), target = accountById(req.body.userId);
        if (room.id === 'default') fail(400, '默认聊天室自动加入');
        if (!target || !areFriends(req.auth.id, target.id)) fail(403, '只能邀请自己的好友');
        if (room.memberIds.includes(target.id)) fail(409, '已在群中');
        let invitation = state.invitations.find(item => item.roomId === room.id && item.from === req.auth.id && item.to === target.id && item.status === 'pending');
        if (!invitation) { invitation = { id: uid(), roomId: room.id, from: req.auth.id, to: target.id, status: 'pending', createdAt: Date.now() }; state.invitations.push(invitation); save(); botUpdate(target, 'invitation', { ...invitation, roomName: room.name }); }
        io.emit('community_changed'); res.json({ invitation, link: '/chat?invitation=' + invitation.id });
    }));
    app.get('/api/group-invitations', authMiddleware, (req, res) => res.json(state.invitations.filter(item => item.to === req.auth.id && item.status === 'pending')
        .filter(item => rooms.has(item.roomId) && areFriends(item.from, item.to) && rooms.get(item.roomId).memberIds.includes(item.from))
        .map(item => { const room = rooms.get(item.roomId); return { ...item, roomName: room.name, fromName: accountById(item.from)?.username,
            joinMode: room.joinMode || 'open', questions: (room.questions || []).map(question => question.question) }; })));
    app.get('/api/groups/:roomId/applications', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); manager(req.auth, room);
        res.json(state.applications.filter(item => item.roomId === room.id && item.status === 'pending').map(item => ({ ...item, user: profile(accountById(item.userId)) })));
    }));
    app.put('/api/groups/:roomId/applications/:id', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); manager(req.auth, room);
        const application = state.applications.find(item => item.id === req.params.id && item.roomId === room.id);
        if (!application || application.status !== 'pending') fail(409, '申请不存在或已处理');
        if (!['accept', 'reject'].includes(req.body.action)) fail(400, '操作无效');
        const account = accountById(application.userId); if (!account) fail(404, '账号不存在');
        if (!room.isPublic && req.body.action === 'accept') {
            const invitation = state.invitations.find(item => item.id === application.invitationId && item.status === 'pending');
            if (!invitation || !room.memberIds.includes(invitation.from) || !areFriends(invitation.from, account.id)) fail(403, '好友邀请已失效');
            if (req.body.action === 'accept') invitation.status = 'accepted';
        }
        application.status = req.body.action;
        if (application.status === 'accept' && !room.memberIds.includes(account.id)) room.memberIds.push(account.id);
        save(); announceChange(room); botUpdate(account, 'join_result', { roomId: room.id, status: application.status }); res.json({ success: true });
    }));
    app.put('/api/groups/:roomId/members/:userId/role', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); manager(req.auth, room, true);
        if (room.id === 'default' || !room.memberIds.includes(req.params.userId) || req.params.userId === room.ownerId) fail(400, '不能调整该成员');
        if (!['admin', 'member'].includes(req.body.role)) fail(400, '角色无效');
        room.adminIds = (room.adminIds || []).filter(id => id !== req.params.userId); if (req.body.role === 'admin') room.adminIds.push(req.params.userId);
        announceChange(room); res.json({ success: true });
    }));
    app.put('/api/groups/:roomId/owner', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); manager(req.auth, room, true);
        const target = accountById(req.body.userId);
        if (!target || target.kind === 'bot' || !room.memberIds.includes(target.id) || room.id === 'default') fail(400, '只能转让给群内人类成员');
        room.ownerId = target.id; room.createdBy = target.username; room.adminIds = room.adminIds.filter(id => id !== target.id); announceChange(room); res.json({ success: true });
    }));
    function removeMember(req, res) {
        const room = group(req.params.roomId, req.auth); manager(req.auth, room);
        const target = accountById(req.params.userId);
        if (room.id === 'default' || !target || !room.memberIds.includes(target.id) || target.id === room.ownerId ||
            (role(req.auth, room) !== 'owner' && role(target, room) === 'admin')) fail(403, '不能移除该成员');
        room.memberIds = room.memberIds.filter(id => id !== target.id); room.adminIds = (room.adminIds || []).filter(id => id !== target.id);
        announceChange(room); res.json({ success: true });
    }
    app.delete('/api/groups/:roomId/members/:userId', authMiddleware, route(removeMember));
    function leave(req, res) {
        const room = group(req.params.roomId, req.auth);
        if (room.id === 'default' || room.ownerId === req.auth.id) fail(400, '默认聊天室不能退出；群主须先转让或解散');
        room.memberIds = room.memberIds.filter(id => id !== req.auth.id); room.adminIds = (room.adminIds || []).filter(id => id !== req.auth.id);
        announceChange(room); res.json({ success: true });
    }
    app.post('/api/groups/:roomId/leave', authMiddleware, route(leave));
    app.delete('/api/groups/:roomId', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth, false);
        if (room.id === 'default') fail(400, '不能解散默认聊天室');
        if (room.ownerId !== req.auth.id && !['admin', 'superadmin'].includes(req.auth.role)) fail(403, '仅群主或聊天室管理员可解散');
        rooms.delete(room.id); saveRooms();
        for (const socket of io.sockets.sockets.values()) {
            socket.leave(roomChannel(room.id));
            if (users.get(socket.id)?.currentRoom === room.id) socket.emit('group_deleted', { roomId: room.id });
        }
        notifyState(); res.json({ success: true });
    }));

    function decorate(account, room, data) {
        const result = { senderRole: role(account, room), senderKind: account.kind || 'human', mentions: [], reactions: [] };
        if (data.replyToId) {
            const original = history(account, room).find(item => item.id === data.replyToId);
            if (!original) fail(400, '引用消息不存在或不在可见记录中');
            result.replyToId = original.id; result.quote = { id: original.id, username: original.username, text: String(original.content || original.name || '').slice(0, 200) };
        }
        if (data.mentions !== undefined && (!Array.isArray(data.mentions) || data.mentions.length > 100)) fail(400, '提及格式无效');
        for (const item of data.mentions || []) {
            if (!item || !['user', 'all'].includes(item.type)) fail(400, '提及格式无效');
            if (room.kind === 'direct' && item.type === 'all') fail(400, '私聊不支持 @全体');
            if (item.type === 'all' && !canManageRoom(account, room)) fail(403, '仅群主和群管理员可 @全体成员');
            if (item.type === 'user' && !room.memberIds.includes(item.userId)) fail(400, '被提及用户不在群中');
            if (data.content !== undefined && (!Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || item.start < 0 || item.end <= item.start)) fail(400, '提及位置无效');
            const sourceLabel = item.type === 'all' ? '全体成员' : accountById(item.userId)?.username;
            const entry = { start: item.start, end: item.end, label: sourceLabel, type: item.type, ...(item.type === 'user' ? { userId: item.userId } : {}) };
            if (!result.mentions.some(existing => existing.start === entry.start && existing.end === entry.end)) result.mentions.push(entry);
        }
        return result;
    }
    function publish(room, message, { notify = true } = {}) {
        messages.get(room.id).push(message); saveMessages();
        io.to(roomChannel(room.id)).emit('message', message);
        for (const id of room.memberIds) { const account = accountById(id); if (account && id !== message.userId) botUpdate(account, 'message', message); }
        if (notify) notifyJiyuRoom(room, message.userId, message); ctx.broadcastRoomList();
        return message;
    }
    function send(account, data) {
        const room = rooms.get(data.roomId || 'default');
        if (!canSendRoom(account, room)) fail(403, '无权发送消息');
        if (ctx.isMuted(account)) fail(403, '你已被禁言');
        const decoration = decorate(account, room, data);
        if (data.content && decoration.mentions.some(item => data.content.slice(item.start, item.end) !== '@' + item.label)) fail(400, '提及正文与账号不匹配');
        let message = { id: uid(), room: room.id, username: account.username, userId: account.id, timestamp: Date.now(), ...decoration };
        if (data.storedName) {
            if (decoration.mentions.length) fail(400, '附件提及请另发文字消息');
            const file = fileStore.files.find(item => item.storedName === data.storedName && !item.expired);
            if (!file || file.roomId !== room.id || (file.uploaderId ? file.uploaderId !== account.id : file.uploader !== account.username)) fail(403, '文件不存在或无权发送');
            message = { ...message, type: 'file', name: file.name, size: file.size, mimeType: file.mimeType, storedName: file.storedName,
                fileUrl: '/uploads/' + encodeURIComponent(file.storedName), isImage: String(file.mimeType).startsWith('image/') };
        } else {
            text(data.content, 20000, '消息', false);
            const processedContent = processMarkdown(data.content, message.id, decoration.mentions);
            if (decoration.mentions.some(item => !processedContent.includes('data-mention-start=\"' + item.start + '\"'))) fail(400, '提及必须出现在正文中，且不能位于代码、公式或链接内');
            message = { ...message, type: 'text', content: data.content, processedContent, isMarkdown: true };
        }
        return publish(room, message);
    }
    app.post('/api/rooms/:roomId/messages', authMiddleware, route((req, res) => res.json({ message: send(req.auth, { ...req.body, roomId: req.params.roomId }) })));
    app.get('/api/rooms/:roomId/search', authMiddleware, route((req, res) => {
        const room = rooms.get(req.params.roomId); if (!canAccessRoom(req.auth, room)) fail(403, '无权访问该会话');
        let list = history(req.auth, room);
        if (req.query.q) list = list.filter(item => String(item.content || item.name || '').toLowerCase().includes(String(req.query.q).toLowerCase()));
        if (req.query.userId) list = list.filter(item => item.userId === req.query.userId);
        if (req.query.type) list = list.filter(item => req.query.type === 'image' ? item.isImage : item.type === req.query.type && (req.query.type !== 'file' || !item.isImage));
        for (const [key, compare] of [['from', (a,b) => a >= b], ['to', (a,b) => a <= b]]) if (req.query[key]) {
            const date = Number(req.query[key]); if (!Number.isFinite(date)) fail(400, '日期无效'); list = list.filter(item => compare(item.timestamp, date));
        }
        res.json(list.slice(-100));
    }));
    app.get('/api/rooms/:roomId/messages/:id/context', authMiddleware, route((req, res) => {
        const room = rooms.get(req.params.roomId); if (!canAccessRoom(req.auth, room)) fail(403, '无权访问该会话');
        const list = history(req.auth, room), index = list.findIndex(item => item.id === req.params.id);
        if (index < 0) fail(404, '消息不在可见记录中'); res.json(list.slice(Math.max(0, index - 15), index + 16));
    }));
    app.put('/api/rooms/:roomId/messages/:id/reactions', authMiddleware, route((req, res) => {
        const room = rooms.get(req.params.roomId); if (!canSendRoom(req.auth, room)) fail(403, '无权回应');
        const message = history(req.auth, room).find(item => item.id === req.params.id); if (!message) fail(404, '消息不存在');
        if (!ctx.emojiIds.has(req.body.emojiId)) fail(400, '表情无效');
        message.reactions ||= [];
        let reaction = message.reactions.find(item => item.emojiId === req.body.emojiId);
        if (!reaction) { reaction = { emojiId: req.body.emojiId, userIds: [] }; message.reactions.push(reaction); }
        if (reaction.userIds.includes(req.auth.id)) reaction.userIds = reaction.userIds.filter(id => id !== req.auth.id); else reaction.userIds.push(req.auth.id);
        message.reactions = message.reactions.filter(item => item.userIds.length);
        saveMessages(); io.to(roomChannel(room.id)).emit('message_updated', message); roomEvent(room, 'message_updated', message); res.json({ message });
    }));
    app.put('/api/groups/:roomId/messages/:id/essence', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); manager(req.auth, room);
        const message = history(req.auth, room).find(item => item.id === req.params.id); if (!message) fail(404, '消息不存在');
        if (typeof req.body.enabled !== 'boolean') fail(400, '精华设置无效');
        message.essence = req.body.enabled; saveMessages(); io.to(roomChannel(room.id)).emit('message_updated', message); roomEvent(room, 'message_updated', message); res.json({ message });
    }));
    app.get('/api/groups/:roomId/essence', authMiddleware, route((req, res) => {
        const room = group(req.params.roomId, req.auth); res.json((messages.get(room.id) || []).filter(item => item.essence));
    }));

    // Dedicated credentials never authenticate human sessions, static source or admin routes.
    const digest = token => crypto.createHash('sha256').update(token).digest('hex');
    function issueBot(account) { const token = 'blt_bot_' + crypto.randomBytes(32).toString('hex'); account.botTokenHash = digest(token); saveUsers(); waiting.get(account.id)?.(); return token; }
    app.get('/api/bots', adminMiddleware, (req, res) => res.json(userStore.users.filter(account => account.kind === 'bot').map(account => ({ ...profile(account), disabled: !!account.disabled }))));
    app.post('/api/bots', adminMiddleware, route((req, res) => {
        const username = text(req.body.username, 20, 'Bot 名称', false);
        if (username.length < 2 || userStore.users.some(account => account.username === username)) fail(409, '名称过短或已被使用');
        const account = { id: uid(), username, kind: 'bot', role: 'user', boundIp: '', registeredIp: '', about: text(req.body.about || '', 500, '简介'), createdAt: Date.now() };
        userStore.users.push(account); rooms.get('default').memberIds.push(account.id); const token = issueBot(account); saveRooms(); autoRequests(); notifyState(); res.json({ bot: profile(account), token });
    }));
    app.put('/api/bots/:userId', adminMiddleware, route((req, res) => {
        const account = accountById(req.params.userId); if (account?.kind !== 'bot') fail(404, 'Bot 不存在');
        if (req.body.about !== undefined) account.about = text(req.body.about, 500, '简介');
        if (req.body.disabled !== undefined) { if (typeof req.body.disabled !== 'boolean') fail(400, '停用设置无效'); account.disabled = req.body.disabled; }
        if (req.body.username !== undefined) { const name = text(req.body.username, 20, '名称', false); if (name.length < 2 || userStore.users.some(item => item.id !== account.id && item.username === name)) fail(409, '名称无效或重复'); account.username = name; }
        saveUsers(); waiting.get(account.id)?.(); autoRequests(); notifyState(); res.json({ bot: profile(account), disabled: !!account.disabled });
    }));
    app.post('/api/bots/:userId/token', adminMiddleware, route((req, res) => {
        const account = accountById(req.params.userId); if (account?.kind !== 'bot') fail(404, 'Bot 不存在');
        res.json({ token: issueBot(account) });
    }));
    app.delete('/api/bots/:userId', adminMiddleware, route((req, res) => {
        const account = accountById(req.params.userId); if (account?.kind !== 'bot') fail(404, 'Bot 不存在');
        userStore.users = userStore.users.filter(item => item.id !== account.id); saveUsers();
        for (const room of rooms.values()) { room.memberIds = room.memberIds.filter(id => id !== account.id); room.adminIds = (room.adminIds || []).filter(id => id !== account.id); }
        social.friends = social.friends.filter(pair => !pair.includes(account.id)); social.requests = social.requests.filter(item => item.from !== account.id && item.to !== account.id);
        delete state.bots[account.id]; save(); saveRooms(); saveSocial(); waiting.get(account.id)?.(); notifyState(); res.json({ success: true });
    }));
    function botAuth(req, res, next) {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const account = userStore.users.find(item => item.kind === 'bot' && !item.disabled && item.botTokenHash === digest(token));
        if (!account) return res.status(401).json({ error: 'Bot 令牌无效或已停用' });
        req.auth = { id: account.id, username: account.username, role: 'user', kind: 'bot', boundIp: '' }; req.botHash = account.botTokenHash; next();
    }
    // Reuse the exact human handlers without bypassing IP middleware on other routes.
    app.use('/api/bot/v1', botAuth, (req, res, next) => {
        const routeMap = { '/me': '/api/bot-profile', '/chats': '/api/rooms', '/friends': '/api/social', '/invitations': '/api/group-invitations' };
        if (req.path === '/updates') return next();
        const allowed = /^\/(groups(?:\/|$)|rooms(?:\/|$)|friend-requests(?:\/|$)|direct-chats$|upload$|files(?:\/|$))/.test(req.path);
        const target = routeMap[req.path] || (allowed ? '/api' + req.path : null);
        if (!target) return res.status(404).json({ error: 'Bot API 不存在' });
        const pathname = req.path, query = req.url.slice(pathname.length);
        req.url = target + query; req.baseUrl = ''; req.originalUrl = req.url;
        req.botInternal = true;
        app.handle(req, res, next);
    });
    app.get('/api/bot/v1/updates', route(async (req, res) => {
        const id = req.auth.id;
        if (polling.has(id)) fail(409, '每个 Bot 只允许一个更新消费者');
        const queue = botState(req.auth), offset = req.query.offset === undefined ? queue.cursor : Number(req.query.offset);
        const timeout = req.query.timeout === undefined ? 0 : Number(req.query.timeout);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isFinite(timeout) || timeout < 0 || timeout > 30) fail(400, '更新参数无效');
        if (offset >= queue.nextId) fail(400, '更新游标超出范围');
        trimQueue(queue); if (offset < queue.floor) { const error = new Error('更新游标已过期，请使用 nextOffset 重新同步'); error.status = 410; error.details = { nextOffset: queue.floor }; throw error; }
        polling.add(id);
        try {
            if (!queue.updates.some(item => item.updateId > offset) && timeout) await new Promise(resolve => {
                const done = () => { clearTimeout(timer); waiting.delete(id); res.off('close', done); resolve(); };
                const timer = setTimeout(done, timeout * 1000); waiting.set(id, done); res.once('close', done);
            });
            const account = accountById(id);
            if (!account || account.disabled || account.botTokenHash !== req.botHash) fail(401, 'Bot 令牌已失效');
            const updates = queue.updates.filter(item => item.updateId > offset).filter(item => {
                const roomId = item.data?.room || item.data?.roomId || (item.type === 'group_changed' ? item.data?.id : null);
                if (item.type === 'join_request' && !canManageRoom(account, rooms.get(roomId))) return false;
                return !roomId || item.type === 'invitation' || item.type === 'join_result' || canAccessRoom(account, rooms.get(roomId));
            }).slice(0, 100);
            queue.cursor = Math.max(queue.cursor, offset); save();
            res.json({ updates, nextOffset: updates.at(-1)?.updateId || Math.max(offset, queue.nextId - 1) });
        } finally { polling.delete(id); }
    }));
    app.get('/api/bot-profile', (req, res) => req.botInternal ? res.json(profile(accountById(req.auth.id))) : res.sendStatus(404));

    // Avatars are persistent, authenticated, decoded images; never accept executable SVG.
    const avatarDir = path.join(DATA_DIR, 'avatars'); fs.mkdirSync(avatarDir, { recursive: true });
    const { PNG } = require('pngjs');
    const jpeg = require('jpeg-js');
    async function avatar(req, res) {
        let target;
        if (req.params.roomId) { target = group(req.params.roomId, req.auth); manager(req.auth, target); }
        else {
            target = accountById(req.params.userId || req.auth.id); if (!target) fail(404, '账号不存在');
            if (target.id !== req.auth.id && !(target.kind === 'bot' && ['admin', 'superadmin'].includes(req.auth.role))) fail(403, '无权修改头像');
        }
        if (req.method === 'DELETE') { target.avatar = ''; }
        else {
            if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > 4 * 1024 * 1024) fail(400, '头像最大 4MB');
            let buffer;
            try {
                let image;
                if (req.body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
                    const width = req.body.readUInt32BE(16), height = req.body.readUInt32BE(20);
                    if (!width || !height || width * height > 16000000) fail(400, '图片尺寸过大');
                    image = PNG.sync.read(req.body, { checkCRC: true });
                } else if (req.body[0] === 255 && req.body[1] === 216) image = jpeg.decode(req.body, { maxResolutionInMP: 16, maxMemoryUsageInMB: 96 });
                else fail(400, '仅支持 PNG/JPEG');
                const result = new PNG({ width: 256, height: 256 });
                const side = Math.min(image.width, image.height), left = (image.width - side) / 2, top = (image.height - side) / 2;
                for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
                    const source = (Math.floor(top + y * side / 256) * image.width + Math.floor(left + x * side / 256)) * 4;
                    image.data.copy(result.data, (y * 256 + x) * 4, source, source + 4);
                }
                buffer = PNG.sync.write(result);
            } catch { fail(400, '图片无效或尺寸过大'); }
            const name = uid() + '.png'; fs.writeFileSync(path.join(avatarDir, name), buffer); target.avatar = '/avatars/' + name;
        }
        saveUsers(); saveRooms(); notifyState(); res.json({ avatar: target.avatar });
    }
    for (const url of ['/api/me/avatar', '/api/bots/:userId/avatar', '/api/groups/:roomId/avatar']) {
        app.put(url, authMiddleware, require('express').raw({ type: () => true, limit: '4mb' }), route(avatar));
        app.delete(url, authMiddleware, route(avatar));
    }
    app.get('/avatars/:name', authMiddleware, (req, res) => {
        if (!/^[\da-f-]+\.png$/.test(req.params.name)) return res.sendStatus(404);
        res.set('X-Content-Type-Options', 'nosniff'); res.sendFile(path.join(avatarDir, req.params.name));
    });
    app.get('/api/files/:name/download', authMiddleware, route((req, res) => {
        const file = fileStore.files.find(item => item.storedName === req.params.name && !item.expired);
        if (!file) fail(404, '文件不存在或已过期');
        if (!canAccessRoom(req.auth, rooms.get(file.roomId))) fail(403, '无权下载附件');
        res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" });
        res.sendFile(path.join(DATA_DIR, 'uploads', file.storedName));
    }));
    // Old creation/join/invitation mutations cannot bypass the new admission model.
    for (const [method, url] of [['post', '/api/rooms'], ['post', '/api/rooms/:roomId/join'], ['post', '/api/rooms/:roomId/invitations'], ['post', '/api/rooms/:roomId/kick-users'], ['delete', '/api/rooms/:roomId']]) {
        app[method](url, authMiddleware, (req, res) => res.status(410).json({ error: '旧房间接口已停用，请使用 /api/groups' }));
    }
    app.post('/api/rooms/:roomId/leave', authMiddleware, route(leave));
    app.delete('/api/rooms/:roomId/members/:userId', authMiddleware, route(removeMember));
    autoRequests(); save();
    return { profile, role, preferences, history, info, members, autoRequests, decorate, publish, send, notifyState,
        eligible: (account, room, message) => policy.eligible(preferences(account, room.id).notificationMode, message, account.id),
        appearance: account => ({ theme: 'light', accent: '#1687f8', preview: true, ...(state.preferences[account.id]?.appearance || {}) }),
        canDeleteAccount: account => ![...rooms.values()].some(room => !room.archived && room.ownerId === account.id),
        botAuth, botUpdate, isInternalBot: req => !!req.botInternal };
};
