        const MessageType = {
            TEXT: 'text',
            JOIN: 'join',
            LEAVE: 'leave',
            USER_LIST: 'user_list',
            TYPING: 'typing'
        };

        class ChatApp {
            constructor() {
                this.socket = null;
                this.currentUser = '';
                this.currentRoom = 'default';
                this.typingTimeout = null;
                this.isConnected = false;
                this.authToken = null;
                this.userRole = 'user';
                this.serverOrigin = '';
                this.roomData = [];
                this.social = { friends: [], requests: [] };
                this.currentMembers = [];
                this.currentCanSend = true;
                this.notifications = new ChatNotifications({
                    currentUser: () => this.currentUser,
                    currentRoom: () => this.currentRoom,
                    roomName: id => this.roomData.find(room => room.id === id)?.name || id,
                    isViewingChat: () => true,
                    openRoom: id => {
                        this.joinRoom(id);
                    },
                    onUnread: () => this.updateRoomUnread(),
                    onHint: text => this.showToast(text)
                });
                this.pendingFiles = [];   // 待上传文件
                this.uploading = false;
                this.limits = { maxFileMB: 5120, maxUploadsMB: 20480 };
                this.expiredFiles = new Set();

                this.initializeEventListeners();
                this.initializeSocialEvents();
                this.initializePanelEvents();
                console.log('聊天室应用初始化完成');
        }

            // 初始化事件监听器
            initializeEventListeners() {
                const messageInput = document.getElementById('message-input');
                const sendButton = document.getElementById('send-button');
                sendButton.addEventListener('click', () => this.sendMessage());
                messageInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.isComposing && e.keyCode !== 229) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                });
                messageInput.addEventListener('input', () => this.handleTyping());

                // 文件传输
                document.getElementById('attach-btn').addEventListener('click', () => document.getElementById('file-input').click());
                document.getElementById('file-input').addEventListener('change', (e) => {
                    this.handleFileSelect(e.target.files);
                    e.target.value = '';
                });
                messageInput.addEventListener('paste', (e) => this.handlePaste(e));
                const dropZone = document.querySelector('.messages-container');
                dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.outline = '2px dashed #6b7280'; });
                dropZone.addEventListener('dragleave', () => { dropZone.style.outline = ''; });
                dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.style.outline = ''; this.handleDrop(e); });
                document.getElementById('file-panel-toggle').addEventListener('click', () => {
                    const panel = document.getElementById('file-panel');
                    panel.classList.toggle('collapsed');
                    const collapsed = panel.classList.contains('collapsed');
                    const btn = document.getElementById('file-panel-toggle');
                    btn.textContent = collapsed ? '◂' : '▸';
                    btn.title = collapsed ? '展开文件栏' : '收起文件栏';
                });

                document.getElementById('logout-btn').addEventListener('click', () => this.logout());
                document.getElementById('notify-btn').addEventListener('click', () => this.toggleNotifications());
                for (const event of ['focus', 'blur']) window.addEventListener(event, () => this.sendClientState());
                document.addEventListener('visibilitychange', () => this.sendClientState());

                window.addEventListener('beforeunload', () => {
                    if (this.socket) this.socket.disconnect();
                });
            }

            // 通知
            toggleNotifications() {
                return this.notifications.toggle();
            }

            // 右上角限时提示
            showToast(text) {
                const container = document.getElementById('toast-container');
                if (!container) return;
                const el = document.createElement('div');
                el.className = 'toast';
                el.textContent = text;
                container.appendChild(el);
                setTimeout(() => {
                    el.classList.add('hide');
                    setTimeout(() => el.remove(), 450);
                }, 3000);
            }

            // ===== 文件传输 =====
            formatSize(bytes) {
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
                if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
                return (bytes / 1073741824).toFixed(2) + ' GB';
            }

            async loadLimits() {
                try {
                    const r = await fetch(this.serverOrigin + '/api/limits');
                    if (r.ok) this.limits = await r.json();
                } catch (e) {}
            }

            handleFileSelect(fileList) {
                Array.from(fileList || []).forEach(f => this.uploadFile(f));
            }

            handlePaste(e) {
                if (!e.clipboardData) return;
                const files = Array.from(e.clipboardData.files || []);
                if (files.length) {
                    e.preventDefault();
                    files.forEach(f => this.uploadFile(f));
                }
            }

            handleDrop(e) {
                const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
                files.forEach(f => this.uploadFile(f));
            }

            renderUploadPreview() {
                const el = document.getElementById('upload-preview');
                if (!this.pendingFiles.length) {
                    el.classList.add('hidden');
                    el.innerHTML = '';
                    return;
                }
                el.classList.remove('hidden');
                el.innerHTML = this.pendingFiles.map(p => `
                    <div class="upload-item">
                        <span>📄 ${this.escapeHtml(p.name)} (${this.formatSize(p.size)})</span>
                        <span class="upload-status">${p.status}</span>
                    </div>`).join('');
            }

            async uploadFile(file) {
                if (!file) return;
                if (!this.socket || !this.isConnected) {
                    alert('尚未连接服务器，无法上传');
                    return;
                }
                const maxBytes = this.limits.maxFileMB * 1024 * 1024;
                if (file.size > maxBytes) {
                    alert(`文件 "${file.name}" 超过单文件上限 ${this.limits.maxFileMB}MB`);
                    return;
                }
                if (file.size === 0) {
                    alert('不能上传空文件');
                    return;
                }

                const uploadRoom = this.currentRoom;
                const item = { name: file.name || ('粘贴文件-' + Date.now()), size: file.size, status: '上传中...' };
                this.pendingFiles.push(item);
                this.renderUploadPreview();

                try {
                    const resp = await fetch(
                        this.serverOrigin + '/api/upload?room=' + encodeURIComponent(uploadRoom),
                        {
                            method: 'POST',
                            headers: {
                                'Authorization': 'Bearer ' + this.authToken,
                                'x-filename': encodeURIComponent(item.name),
                                'x-mime': file.type || 'application/octet-stream',
                                'Content-Type': 'application/octet-stream'
                            },
                            body: file
                        }
                    );
                    const data = await resp.json().catch(() => ({}));
                    if (!resp.ok) {
                        item.status = '❌ ' + (data.error || '上传失败');
                    } else {
                        item.status = '✅ 已发送';
                        this.socket.emit('send_file', {
                            storedName: data.file.storedName,
                            roomId: uploadRoom
                        });
                    }
                } catch (err) {
                    item.status = '❌ 上传失败: ' + err.message;
                }
                this.renderUploadPreview();
                // 3秒后移除已完成项
                const idx = this.pendingFiles.indexOf(item);
                setTimeout(() => {
                    if (idx > -1) this.pendingFiles.splice(idx, 1);
                    else this.pendingFiles = this.pendingFiles.filter(p => p !== item);
                    this.renderUploadPreview();
                }, 3000);
            }

            // 右侧文件栏
            async loadFilePanel() {
                if (!this.serverOrigin || !this.authToken) return;
                const requestedRoom = this.currentRoom;
                try {
                    const resp = await fetch(
                        this.serverOrigin + '/api/files?room=' + encodeURIComponent(requestedRoom),
                        { headers: { 'Authorization': 'Bearer ' + this.authToken } }
                    );
                    if (!resp.ok) return;
                    const files = await resp.json();
                    if (this.currentRoom === requestedRoom) this.renderFilePanel(files);
                } catch (e) {}
            }

            renderFilePanel(files) {
                const el = document.getElementById('file-list');
                if (!this.expiredFiles) this.expiredFiles = new Set();
                files.forEach(f => { if (f.expired) this.expiredFiles.add(f.storedName); });
                if (!files.length) {
                    el.innerHTML = '<div class="file-empty">暂无文件</div>';
                    return;
                }
                el.innerHTML = files.map(f => `
                    <div class="file-entry ${f.expired ? 'expired' : ''}" data-stored="${this.escapeHtml(f.storedName)}">
                        <div class="file-name">${this.escapeHtml(f.name)}${f.expired ? '<span class="expired-tag">已过期</span>' : ''}</div>
                        <div class="file-meta">${this.formatSize(f.size)} • ${this.escapeHtml(f.uploader)} • ${new Date(f.createdAt).toLocaleString()}</div>
                        <div class="file-actions">
                            ${f.expired
                                ? '<button disabled style="background:#bdc3c7;">已过期</button>'
                                : `<a href="${this.serverOrigin}${f.url}" target="_blank" download="${this.escapeHtml(f.name)}">下载</a>`}
                        </div>
                    </div>`).join('');
            }

            markFileExpired(storedName) {
                if (!this.expiredFiles) this.expiredFiles = new Set();
                this.expiredFiles.add(storedName);
                const entry = document.querySelector(`.file-entry[data-stored="${CSS.escape(storedName)}"]`);
                if (entry) {
                    entry.classList.add('expired');
                    const nameEl = entry.querySelector('.file-name');
                    if (nameEl && !nameEl.querySelector('.expired-tag')) {
                        nameEl.insertAdjacentHTML('beforeend', '<span class="expired-tag">已过期</span>');
                    }
                    const actions = entry.querySelector('.file-actions');
                    if (actions) actions.innerHTML = '<button disabled style="background:#bdc3c7;">已过期</button>';
                }
            }

            renderFileMessage(message) {
                const time = new Date(message.timestamp).toLocaleTimeString();
                const header = `
                    <div class="message-header">
                        ${this.escapeHtml(message.username)} • ${time}
                    </div>`;
                const expired = this.expiredFiles && this.expiredFiles.has(message.storedName);
                const url = this.serverOrigin + message.fileUrl;

                let body;
                if (message.isImage) {
                    body = expired
                        ? `<div class="expired-media">⚠️ 图片已过期（因存储空间限制被清理）</div>`
                        : `<div class="msg-image"><a href="${url}" target="_blank"><img src="${url}" alt="${this.escapeHtml(message.name)}" loading="lazy"></a></div>`;
                } else {
                    body = `
                        <div class="msg-file-card">
                            <div class="file-icon">📄</div>
                            <div class="file-info">
                                <div class="fname">${this.escapeHtml(message.name)}</div>
                                <div class="fmeta">${this.formatSize(message.size)}${expired ? ' • ⚠️ 已过期' : ''}</div>
                            </div>
                            ${expired
                                ? '<span style="font-size:12px;color:#e74c3c;">已过期</span>'
                                : `<a class="dl" href="${url}" target="_blank" download="${this.escapeHtml(message.name)}">下载</a>`}
                        </div>`;
                }
                return header + body;
            }

            // 加入房间
            joinRoom(roomId, roomName) {
                if (!this.socket || !this.isConnected) {
                    alert('请先连接服务器');
                    return;
                }

                this.socket.emit('join_room', {
                    roomId: roomId
                });

            }

            // 连接服务器
            connectToServer(origin) {
                try {
                    console.log(`正在连接服务器: ${origin}`);

                    if (typeof io === 'undefined') {
                        alert('Socket.IO库加载失败，请检查网络连接');
                        return;
                    }

                    this.socket = io(origin, {
                        timeout: 10000,
                        reconnectionAttempts: 3,
                        reconnectionDelay: 2000
                    });

                    this.setupSocketListeners();

                } catch (error) {
                    this.showError('连接失败: ' + error.message);
                }
            }

            // 设置Socket事件监听器
            setupSocketListeners() {
                if (!this.socket) return;

                // 连接成功
                this.socket.on('connect', () => {
                    console.log('成功连接到服务器');
                    this.isConnected = true;
                    this.sendClientState();
                    this.updateConnectionStatus('connected');

                    this.showSystemMessage('✅ 连接服务器成功！正在加入聊天室...');

                    // 加入默认房间
                    this.socket.emit('join', {
                        token: this.authToken,
                        roomId: this.currentRoom
                    });

                    // 显示聊天界面
                    this.showChatScreen();
                });

                // 连接错误
                this.socket.on('connect_error', (error) => {
                    console.error('连接错误:', error);
                    this.isConnected = false;
                    this.updateConnectionStatus('disconnected');
                    this.showError('❌ 连接错误: ' + (error.message || '未知错误'));
                });

                this.socket.on('account_changed', account => { this.applyAccount(account); this.loadSocial(); });
                this.socket.on('social_changed', info => { this.social = info; this.renderSocial(); });
                this.socket.on('room_invited', room => this.showToast(`已获邀加入私有房间：${room.roomName}`));
                this.socket.on('kicked_from_room', data => this.showToast(data.reason));

                // 房间创建成功
                this.socket.on('room_created', (data) => {
                    const { roomId, roomName } = data;
                    this.showSystemMessage(`✅ 房间 "${roomName}" 创建成功！`);
                    // 自动加入新创建的房间
                    this.joinRoom(roomId, roomName);
                });

                // 房间加入成功
                this.socket.on('room_joined', (data) => {
                    const { roomId, roomName, userCount } = data;
                    this.currentRoom = roomId;
                    this.closePanels();
                    this.currentCanSend = data.canSend !== false;
                    if (this.currentCanSend) this.enableChatInput(); else this.disableChatInput();
                    this.sendClientState();
                    this.loadMembers();
                    this.renderConversationActions();
                    const heading = document.getElementById('current-room');
                    heading.replaceChildren(document.createTextNode(roomName + ' '));
                    const status = document.createElement('span');
                    status.id = 'connection-status';
                    status.className = 'connection-status status-connected';
                    status.textContent = '已连接';
                    heading.appendChild(status);
                    document.getElementById('typing-indicator').textContent = '';
                    this.showSystemMessage(`✅ 已加入房间: ${roomName} (${userCount}人在线)`);

                    this.notifications.markRead();
                    // 更新房间列表激活状态
                    this.updateRoomActiveState(roomId);
                    // 刷新右侧文件栏
                    this.renderFilePanel([]);
                    this.loadFilePanel();
                });

                // 房间列表更新
                this.socket.on('room_list', (rooms) => {
                    console.log('收到房间列表:', rooms);
                    this.updateRoomList(rooms);
                });

                // 接收消息
                this.socket.on('message', (message) => {
                    const room = this.roomData.find(r => r.id === message.room);
                    if (room) room.lastMessage = { timestamp: message.timestamp, preview: message.type === 'file' ? (message.isImage ? '[图片]' : '[文件]') : String(message.content || '').slice(0, 80) };
                    this.notifications.receive(message);
                    this.renderConversations();
                    if (message.room && message.room !== this.currentRoom) return;
                    this.displayMessage(message);
                    // 收到文件消息时立即刷新右侧文件栏
                    if (message.type === 'file') this.loadFilePanel();
                });

                // 用户进入 / 离开（右上角限时提示）
                this.socket.on('user_joined', (data) => {
                    if (!data || data.room !== this.currentRoom || !data.username || data.username === this.currentUser) return;
                    this.showToast(`✅ ${data.username} 加入了${data.reason === 'switch' ? '房间' : '聊天室'}`);
                });
                this.socket.on('user_left', (data) => {
                    if (!data || data.room !== this.currentRoom || !data.username || data.username === this.currentUser) return;
                    this.showToast(`👋 ${data.username} 离开了${data.reason === 'switch' ? '房间' : '聊天室'}`);
                });

                // 接收历史消息
                this.socket.on('message_history', (messages, roomId) => {
                    if (roomId !== this.currentRoom) return;
                    const container = document.getElementById('messages-container');
                    container.innerHTML = '';
                    messages.forEach(msg => this.displayMessage(msg));
                    this.scrollToBottom();
                });

                // 更新用户列表
                this.socket.on('user_list', (users, roomId) => {
                    if (roomId !== this.currentRoom) return;
                    this.updateUserList(users);
                });

                // 用户输入状态
                this.socket.on('user_typing', (data) => {
                    if (data.room !== this.currentRoom) return;
                    this.showTypingIndicator(data.username, data.isTyping);
                });

                // 错误处理
                this.socket.on('error', (error) => {
                    console.error('Socket错误:', error);
                    if (typeof error === 'string' && error.includes('登录已过期')) {
                        alert('登录已过期，请重新登录');
                        this.logout();
                        return;
                    }
                    this.showError('❌ ' + error);
                });

                // 文件过期通知
                this.socket.on('file_expired', (data) => {
                    if (data && data.storedName) this.markFileExpired(data.storedName);
                });

                // 连接断开
                this.socket.on('disconnect', () => {
                    this.isConnected = false;
                    this.updateConnectionStatus('disconnected');
                    this.showError('❌ 与服务器断开连接');
                    this.disableChatInput();
                });
            }

            // 更新连接状态显示
            updateConnectionStatus(status) {
                const statusElement = document.getElementById('connection-status');
                if (status === 'connected') {
                    statusElement.textContent = '已连接';
                    statusElement.className = 'connection-status status-connected';
                } else if (status === 'connecting') {
                    statusElement.textContent = '连接中';
                    statusElement.className = 'connection-status status-connecting';
                } else {
                    statusElement.textContent = '未连接';
                    statusElement.className = 'connection-status status-disconnected';
                }
            }

            // 显示聊天界面
            showChatScreen() {

                const chatScreen = document.getElementById('chat-screen');


                chatScreen.classList.remove('hidden');

                // 启用消息输入
                this.enableChatInput();

                // 获取房间列表
                if (this.socket) {
                    this.socket.emit('get_rooms');
                    console.log('已发送获取房间列表请求');
                }

                // 加载文件限制与房间文件列表
                this.loadLimits();
                this.loadFilePanel();

                // 聚焦消息输入框
                const messageInput = document.getElementById('message-input');
                setTimeout(() => messageInput.focus(), 100);
            }

            // 启用聊天输入
            enableChatInput() {
                const messageInput = document.getElementById('message-input');
                const sendButton = document.getElementById('send-button');
                const attachBtn = document.getElementById('attach-btn');

                messageInput.disabled = false;
                document.querySelectorAll('#markdown-toolbar button').forEach(button => { button.disabled = false; });
                attachBtn.disabled = false;
                messageInput.placeholder = '输入 Markdown，右侧实时预览…';
                this.updateSendButtonState();
            }

            // 禁用聊天输入
            disableChatInput() {
                const messageInput = document.getElementById('message-input');
                const sendButton = document.getElementById('send-button');
                const attachBtn = document.getElementById('attach-btn');

                messageInput.disabled = true;
                document.querySelectorAll('#markdown-toolbar button').forEach(button => { button.disabled = true; });
                attachBtn.disabled = true;
                messageInput.placeholder = this.isConnected ? '已解除好友关系，只能查看历史记录' : '与服务器断开连接，无法发送消息';
                sendButton.disabled = true;
            }

            // 发送消息
            sendMessage() {
                const messageInput = document.getElementById('message-input');
                const content = messageInput.value;

                if (!content.trim() || !this.socket || !this.isConnected || this.currentCanSend === false) return;

                this.socket.emit('send_message', {
                    content: content,
                    roomId: this.currentRoom
                });

                // 清空输入框
                messageInput.value = '';
                messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                messageInput.dispatchEvent(new Event('message-sent'));
                this.updateSendButtonState();

                // 停止输入状态
                this.socket.emit('typing', { isTyping: false, roomId: this.currentRoom });
            }

            // 处理输入状态
            handleTyping() {
                const messageInput = document.getElementById('message-input');

                // 更新发送按钮状态
                this.updateSendButtonState();

                if (!this.socket || !this.isConnected) return;

                // 发送输入状态
                const isTyping = messageInput.value.length > 0;
                this.socket.emit('typing', { isTyping, roomId: this.currentRoom });

                // 清除之前的超时
                if (this.typingTimeout) {
                    clearTimeout(this.typingTimeout);
                }

                // 设置新的超时，停止输入状态
                this.typingTimeout = setTimeout(() => {
                    if (this.socket) {
                        this.socket.emit('typing', { isTyping: false, roomId: this.currentRoom });
                    }
                }, 1000);
            }

            // 更新发送按钮状态
            updateSendButtonState() {
                const messageInput = document.getElementById('message-input');
                const sendButton = document.getElementById('send-button');

                sendButton.disabled = messageInput.value.trim().length === 0 || !this.isConnected || this.currentCanSend === false;
            }

            // 显示消息
            displayMessage(message) {
                const container = document.getElementById('messages-container');

                // 用户进出已改为右上角限时提示，不再占用消息区（历史消息同样跳过）
                if (message.type === 'join' || message.type === 'leave') {
                    return;
                }

                const messageElement = document.createElement('div');

                messageElement.className = `message ${
                    message.type === 'admin'
                        ? 'system'
                        : (message.userId ? message.userId === this.currentUserId : message.username === this.currentUser)
                            ? 'own'
                            : 'other'
                } ${message.isMarkdown ? 'markdown-content' : ''}`;

                const time = new Date(message.timestamp).toLocaleTimeString();

                let content = '';
                if (message.type === 'admin') {
                    // 管理员/系统提示：套用大消息框
                    content = this.escapeHtml(message.content).replace(/\n/g, '<br>');
                } else if (message.type === 'file') {
                    content = this.renderFileMessage(message);
                } else {
                    let messageContent;
                    if (message.isMarkdown && message.processedContent) {
                        // 使用服务器处理后的Markdown内容
                        messageContent = message.processedContent;
                    } else {
                        // 普通文本
                        messageContent = this.escapeHtml(message.content);
                    }

                    content = `
                        <div class="message-header">
                            ${this.escapeHtml(message.username)} • ${time}
                        </div>
                        <div class="message-content">${messageContent}</div>
                    `;
                }

                messageElement.innerHTML = content;
                messageElement.dataset.timestamp = message.timestamp;
                messageElement.dataset.messageId = message.id;
                container.appendChild(messageElement);

                this.scrollToBottom();
            }

            // 显示系统消息
            showSystemMessage(content) {
                const container = document.getElementById('messages-container');
                const messageElement = document.createElement('div');
                messageElement.className = 'message system';
                messageElement.textContent = content;
                container.appendChild(messageElement);
                this.scrollToBottom();
            }

            // 显示错误消息
            showError(content) {
                const container = document.getElementById('messages-container');
                const messageElement = document.createElement('div');
                messageElement.className = 'message error';
                messageElement.textContent = content;
                container.appendChild(messageElement);
                this.scrollToBottom();
            }

            // 更新用户列表
            // 显示输入状态
            showTypingIndicator(username, isTyping) {
                const indicator = document.getElementById('typing-indicator');

                if (isTyping && username !== this.currentUser) {
                    indicator.textContent = `✍️ ${username} 正在输入...`;
                } else {
                    indicator.textContent = '';
                }
            }

            // 滚动到底部
            scrollToBottom() {
                if (this.prependingHistory) return;
                const container = document.getElementById('messages-container');
                setTimeout(() => {
                    container.scrollTop = container.scrollHeight;
                }, 100);
            }

            // HTML转义
            escapeHtml(unsafe) {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }
        }


        // Markdown 帮助功能
        function showMarkdownHelp() {
            document.getElementById('markdown-help').style.display = 'block';
            document.getElementById('overlay').style.display = 'block';
        }

        function hideMarkdownHelp() {
            document.getElementById('markdown-help').style.display = 'none';
            document.getElementById('overlay').style.display = 'none';
        }

        // 点击遮罩层关闭帮助
        document.getElementById('overlay').addEventListener('click', hideMarkdownHelp);

        // ESC键关闭帮助
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                hideMarkdownHelp();
            }
        });

Object.assign(ChatApp.prototype, {
    initializePanelEvents() {
        const sidebar = document.getElementById('conversation-sidebar'), details = document.getElementById('chat-details');
        const backdrop = document.getElementById('panel-backdrop');
        const update = () => {
            const leftOverlay = matchMedia('(max-width:699px)').matches;
            const rightOverlay = matchMedia('(max-width:1199px)').matches;
            document.getElementById('sidebar-toggle').setAttribute('aria-expanded', String(!leftOverlay || sidebar.classList.contains('is-open')));
            document.getElementById('details-toggle').setAttribute('aria-expanded', String(!rightOverlay || details.classList.contains('is-open')));
            backdrop.classList.toggle('hidden', !(leftOverlay && sidebar.classList.contains('is-open') || rightOverlay && details.classList.contains('is-open')));
        };
        this.updatePanelState = update;
        document.getElementById('sidebar-toggle').onclick = () => { details.classList.remove('is-open'); sidebar.classList.toggle('is-open'); update(); };
        document.getElementById('details-toggle').onclick = () => { sidebar.classList.remove('is-open'); details.classList.toggle('is-open'); update(); };
        backdrop.onclick = () => this.closePanels();
        document.getElementById('sidebar-close').onclick = () => this.closePanels();
        document.getElementById('details-close').onclick = () => this.closePanels();
        document.addEventListener('keydown', event => { if (event.key === 'Escape') this.closePanels(); });
        window.addEventListener('resize', () => this.closePanels());
        update();
    },
    closePanels() {
        document.getElementById('conversation-sidebar').classList.remove('is-open');
        document.getElementById('chat-details').classList.remove('is-open');
        this.updatePanelState?.();
    },
    async request(path, options = {}) {
        const response = await fetch(path, { ...options, headers: {
            'Content-Type': 'application/json', ...(this.authToken ? { Authorization: 'Bearer ' + this.authToken } : {}), ...options.headers
        }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { location.replace('/'); throw new Error('登录已过期'); }
        if (!response.ok) throw new Error(data.error || '操作失败');
        return data;
    },
    applyAccount(account) {
        this.currentUser = account.username; this.currentUserId = account.id || this.currentUserId; this.userRole = account.role;
        document.getElementById('self-name').textContent = account.username;
        document.getElementById('admin-view-btn').classList.toggle('hidden', !['admin', 'superadmin'].includes(account.role));
        if (account.token) this.authToken = account.token;
    },
    async logout() {
        try { await this.request('/api/logout', { method: 'POST' }); }
        finally { localStorage.removeItem('lantalk_auth'); sessionStorage.removeItem('lantalk_auth'); this.socket?.disconnect(); location.replace('/'); }
    },
    sendClientState() {
        if (this.socket && this.isConnected) this.socket.emit('client_state', { isViewing: !document.hidden && document.hasFocus() });
    },
    async loadSocial() {
        try { this.social = await this.request('/api/social'); this.renderSocial(); }
        catch(error) { this.showToast(error.message); }
    },
    initializeSocialEvents() {
        document.getElementById('conversation-search').addEventListener('input', () => this.renderConversations());
        document.getElementById('friend-requests-btn').onclick = () => document.getElementById('friend-requests').classList.toggle('hidden');
        document.getElementById('people-search-form').onsubmit = async event => {
            event.preventDefault();
            try { const people = await this.request('/api/people?q=' + encodeURIComponent(document.getElementById('people-search').value)); this.renderPeople(people); }
            catch(error) { this.showToast(error.message); }
        };
        document.getElementById('discover-btn').onclick = async () => {
            const panel = document.getElementById('discover-panel'); panel.classList.toggle('hidden');
            if (panel.classList.contains('hidden')) return;
            try {
                const rooms = await this.request('/api/public-rooms'); panel.replaceChildren();
                for (const room of rooms) this.makeActionRow(panel, room.name, room.joined ? '打开' : '加入', async () => {
                    if (!room.joined) await this.request('/api/rooms/' + encodeURIComponent(room.id) + '/join', { method: 'POST' });
                    this.joinRoom(room.id); panel.classList.add('hidden');
                });
            } catch(error) { this.showToast(error.message); }
        };
        document.getElementById('older-messages').onclick = () => this.loadOlderMessages();
        document.getElementById('device-btn').onclick = async () => {
            try {
                const data = await this.request('/api/my-notification-devices');
                this.showToast(data.enabled ? ('极域通知设备：' + (data.ips.join('、') || '尚未绑定，请联系管理员')) : '极域通知尚未开启，请联系管理员');
            } catch(error) { this.showToast(error.message); }
        };
    },
    makeActionRow(container, label, action, handler) {
        const row = document.createElement('div'); row.className = 'action-row';
        const name = document.createElement('span'); name.textContent = label;
        const button = document.createElement('button'); button.textContent = action;
        button.onclick = async () => { button.disabled = true; try { await handler(); } catch(error) { this.showToast(error.message); } finally { button.disabled = false; } };
        row.append(name, button); container.append(row); return row;
    },
    renderSocial() {
        const incoming = this.social.requests.filter(request => request.to === this.currentUserId);
        document.getElementById('request-count').textContent = incoming.length ? '(' + incoming.length + ')' : '';
        const panel = document.getElementById('friend-requests'); panel.replaceChildren();
        if (!this.social.requests.length) panel.textContent = '暂无好友申请';
        for (const request of this.social.requests) {
            const received = request.to === this.currentUserId;
            const act = action => this.request('/api/friend-requests/' + encodeURIComponent(request.id), { method: 'PUT', body: { action } });
            const row = this.makeActionRow(panel, received ? request.fromUser : '已申请 ' + request.toUser,
                received ? '接受' : '撤回', () => act(received ? 'accept' : 'withdraw'));
            if (received) {
                const reject = document.createElement('button'); reject.textContent = '拒绝';
                reject.onclick = () => act('reject').catch(error => this.showToast(error.message)); row.append(reject);
            }
        }
        this.renderConversations(); this.updateUserList(this.currentMembers); this.renderConversationActions();
        if (this.peopleResults) this.renderPeople(this.peopleResults);
    },
    async addFriend(id) { await this.request('/api/friend-requests', { method: 'POST', body: { userId: id } }); this.showToast('好友申请已发送'); },
    async openDirect(id) {
        const { room } = await this.request('/api/direct-chats', { method: 'POST', body: { userId: id } });
        this.joinRoom(room.id);
    },
    renderPeople(people) {
        this.peopleResults = people;
        const container = document.getElementById('people-results'); container.replaceChildren();
        if (!people.length) container.textContent = '未找到用户';
        for (const person of people) {
            const friend = this.social.friends.some(friend => friend.id === person.id);
            this.makeActionRow(container, person.username, friend ? '私聊' : '加好友',
                () => friend ? this.openDirect(person.id) : this.addFriend(person.id));
        }
    },
    async loadMembers() {
        const room = this.currentRoom;
        try { const members = await this.request('/api/rooms/' + encodeURIComponent(room) + '/members'); if (room === this.currentRoom) this.updateUserList(members); }
        catch(error) { this.showToast(error.message); }
    },
    updateUserList(members) {
        this.currentMembers = members;
        const list = document.getElementById('user-list'); list.replaceChildren();
        document.getElementById('online-count').textContent = members.filter(m => m.online).length + '/' + members.length + ' 在线';
        for (const person of members) {
            if (person.id === this.currentUserId) {
                const self = document.createElement('div'); self.className = 'action-row'; self.textContent = person.username + '（你）'; list.append(self); continue;
            }
            const friend = this.social.friends.some(friend => friend.id === person.id);
            this.makeActionRow(list, person.username + (person.online ? ' · 在线' : ' · 离线'), friend ? '私聊' : '加好友',
                () => friend ? this.openDirect(person.id) : this.addFriend(person.id));
        }
    },
    updateRoomList(rooms) {
        this.roomData = rooms; this.notifications.pruneRooms(rooms.map(room => room.id));
        const current = rooms.find(room => room.id === this.currentRoom);
        if (current) {
            this.currentCanSend = current.canSend !== false;
            if (this.isConnected && this.currentCanSend) this.enableChatInput(); else this.disableChatInput();
        }
        this.renderConversations(); this.renderConversationActions();
    },
    renderConversations() {
        const container = document.getElementById('room-list'); container.replaceChildren();
        const query = document.getElementById('conversation-search').value.trim().toLowerCase();
        const rooms = this.roomData.filter(room => room.name.toLowerCase().includes(query));
        rooms.sort((a,b) => (b.lastMessage?.timestamp || b.created) - (a.lastMessage?.timestamp || a.created));
        for (const room of rooms) {
            const item = document.createElement('button'); item.className = 'room-item' + (room.id === this.currentRoom ? ' active' : ''); item.dataset.roomId = room.id;
            const unread = this.notifications.unread.get(room.id) || 0;
            const name = document.createElement('strong'); name.textContent = room.name;
            const info = document.createElement('span'); info.className = 'conversation-preview';
            info.textContent = (room.kind === 'direct' ? (room.canSend ? '好友' : '历史私聊') : '群聊') + ' · ' + (room.lastMessage?.preview || '暂无消息');
            item.append(name, info);
            if (unread) { const badge = document.createElement('span'); badge.className = 'unread-badge'; badge.textContent = unread; item.append(badge); }
            item.onclick = () => this.joinRoom(room.id); container.append(item);
        }
        // Accepted friends get a conversation immediately; also show friends whose conversation has not loaded yet.
        for (const friend of this.social.friends.filter(friend => friend.username.toLowerCase().includes(query))) {
            if (rooms.some(room => room.peerId === friend.id)) continue;
            this.makeActionRow(container, friend.username, '私聊', () => this.openDirect(friend.id));
        }
    },
    updateRoomUnread() { this.renderConversations(); },
    updateRoomActiveState() { this.renderConversations(); },
    renderConversationActions() {
        const container = document.getElementById('conversation-actions'); container.replaceChildren();
        const room = this.roomData.find(room => room.id === this.currentRoom); if (!room) return;
        if (room.kind === 'direct') {
            if (room.canSend) this.makeActionRow(container, '好友关系', '删除好友', async () => {
                if (confirm('删除好友后不能再发送新消息，历史记录会保留。')) await this.request('/api/friends/' + encodeURIComponent(room.peerId), { method: 'DELETE' });
            });
            else this.makeActionRow(container, '仅查看历史', '重新加好友', () => this.addFriend(room.peerId));
        } else if (room.id !== 'default') this.makeActionRow(container, '当前群聊', '退出群聊', async () => {
            if (confirm('退出此群聊？')) await this.request('/api/rooms/' + encodeURIComponent(room.id) + '/leave', { method: 'POST' });
        });
    },
    async loadOlderMessages() {
        const room = this.currentRoom, container = document.getElementById('messages-container');
        const before = container.querySelector('.message[data-message-id]')?.dataset.messageId;
        try {
            const messages = await this.request('/api/rooms/' + encodeURIComponent(room) + '/messages' + (before ? '?beforeId=' + encodeURIComponent(before) : ''));
            if (room !== this.currentRoom) return;
            if (!messages.length) return this.showToast('没有更早的消息');
            const height = container.scrollHeight;
            const fragment = document.createDocumentFragment();
            this.prependingHistory = true;
            for (const message of messages) { this.displayMessage(message); fragment.append(container.lastElementChild); }
            this.prependingHistory = false;
            container.prepend(fragment); container.scrollTop += container.scrollHeight - height;
        } catch(error) { this.showToast(error.message); }
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    window.chatApp = new ChatApp();
    const app = window.chatApp;
    try {
        const me = await app.request('/api/me'); app.applyAccount(me); app.serverOrigin = location.origin;
        await app.loadSocial(); app.connectToServer(location.origin);
    } catch { location.replace('/'); }
});
