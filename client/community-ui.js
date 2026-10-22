'use strict';
(function () {
    const $ = id => document.getElementById(id);
    const E = (tag, cls, value) => { const element = document.createElement(tag); if (cls) element.className = cls; if (value !== undefined) element.textContent = value; return element; };
    const iconButton = (name, label, action) => { const button = E('button', 'icon-button'); button.type = 'button'; button.innerHTML = ChatIcons.svg(name); button.title = label; button.setAttribute('aria-label', label); button.onclick = action; return button; };
    const old = {};
    for (const name of ['setupSocketListeners', 'applyAccount', 'updateRoomList', 'renderSocial', 'renderFilePanel', 'joinRoom']) old[name] = ChatApp.prototype[name];
    const safe = (app, fn) => async (...args) => { try { return await fn(...args); } catch (error) { app.showToast(error.message); } };
    Object.assign(ChatApp.prototype, {
        initializeCommunity() {
            this.activeView = 'chats'; this.contactTab = 'friends'; this.messageCache = new Map(); this.mentionChoices = new Map();
            this.appearance = { theme: 'light', accent: '#1687f8', preview: true };
            this.systemTheme = matchMedia('(prefers-color-scheme: dark)');
            this.systemTheme.addEventListener('change', () => this.applyAppearance(this.appearance));
            $('nav-chats').onclick = () => this.setView('chats'); $('nav-contacts').onclick = () => this.setView('contacts');
            $('toolbox-btn').onclick = () => { $('toolbox').classList.toggle('hidden'); $('toolbox-btn').setAttribute('aria-expanded', String(!$('toolbox').classList.contains('hidden'))); };
            $('profile-btn').onclick = safe(this, () => this.openProfile()); $('theme-btn').onclick = () => this.openTheme();
            $('preview-toggle').onclick = safe(this, () => this.saveAppearance({ preview: !this.appearance.preview }));
            $('create-group-btn').onclick = () => this.editGroup(); $('discover-btn').onclick = safe(this, () => this.discoverGroups());
            $('group-settings-btn').onclick = safe(this, () => this.openChatSettings());
            $('invite-btn').onclick = safe(this, () => this.inviteFriends()); $('review-btn').onclick = safe(this, () => this.reviewApplications());
            $('essence-btn').onclick = safe(this, () => this.openEssence()); $('history-search-btn').onclick = () => this.openSearch();
            $('files-btn').onclick = safe(this, () => this.openFiles());
            $('emoji-btn').onclick = () => this.openEmojiPicker();
            $('dialog-close').onclick = () => $('app-dialog').close();
            $('app-dialog').addEventListener('click', event => { if (event.target === $('app-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
            $('contact-tabs').querySelectorAll('button').forEach(button => { button.onclick = () => { this.contactTab = button.dataset.tab; this.renderConversations(); }; });
            document.addEventListener('click', event => {
                if (!event.target.closest('#message-menu')) $('message-menu').classList.add('hidden');
                if (!event.target.closest('#emoji-picker, #emoji-btn, #message-menu, .reaction-chip')) $('emoji-picker').classList.add('hidden');
                if (!event.target.closest('#toolbox, #toolbox-btn')) $('toolbox').classList.add('hidden');
            });
            document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('message-menu').classList.add('hidden'); $('emoji-picker').classList.add('hidden'); } });
            this.initializeSuggestions(); ChatIcons.paint();
            fetch('/api/status').then(response => response.json()).then(data => { $('app-version').textContent = 'v' + data.version; }).catch(() => {});
        },
        applyAccount(account) {
            old.applyAccount.call(this, account); this.account = { ...this.account, ...account };
            $('profile-btn').replaceChildren(this.avatar(this.account));
            if (account.preferences) this.applyAppearance(account.preferences);
            else this.request('/api/preferences').then(prefs => this.applyAppearance(prefs)).catch(() => {});
        },
        applyAppearance(settings) {
            this.appearance = { ...this.appearance, ...settings };
            document.documentElement.dataset.theme = this.appearance.theme === 'system' ? this.systemTheme.matches ? 'dark' : 'light' : this.appearance.theme;
            document.documentElement.style.setProperty('--accent', this.appearance.accent);
            $('composer-panes').classList.toggle('no-preview', !this.appearance.preview);
            $('preview-toggle').setAttribute('aria-pressed', String(this.appearance.preview));
        },
        async saveAppearance(patch) { await this.request('/api/preferences', { method: 'PUT', body: patch }); this.applyAppearance(patch); },
        openTheme() {
            const body = this.dialog('主题'); const form = E('form', 'settings-form');
            const select = this.selectField(form, '外观', [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']], this.appearance.theme);
            const color = this.field(form, '强调色', this.appearance.accent, 'color');
            const presets = E('div', 'color-presets');
            for (const value of ['#1687f8', '#20a278', '#9869da', '#df7551', '#607d8b']) { const button = iconButton('smile', '选择 ' + value, () => { color.value = value; }); button.style.color = value; presets.append(button); }
            form.append(presets); this.submit(form, '保存', async () => { await this.saveAppearance({ theme: select.value, accent: color.value }); $('app-dialog').close(); }); body.append(form);
        },
        avatar(person, large = false) {
            const element = E('span', 'avatar' + (large ? ' large' : ''));
            if (person?.avatar) { const image = E('img'); image.src = person.avatar; image.alt = ''; element.append(image); }
            else if (person?.kind === 'bot') element.innerHTML = ChatIcons.svg('bot');
            else element.textContent = (person?.username || person?.name || '?').slice(0, 1).toUpperCase();
            return element;
        },
        setView(view) {
            this.activeView = view; document.body.dataset.view = view;
            $('nav-chats').classList.toggle('selected', view === 'chats'); $('nav-contacts').classList.toggle('selected', view === 'contacts');
            $('contact-tabs').classList.toggle('hidden', view !== 'contacts'); this.renderConversations(); this.sendClientState();
            if (view === 'chats') this.notifications.markRead();
        },
        joinRoom(id, name) {
            this.setView('chats');
            $('friend-requests').classList.add('hidden'); $('emoji-picker').classList.add('hidden'); $('message-menu').classList.add('hidden');
            this.request('/api/rooms/' + encodeURIComponent(id) + '/settings', { method: 'PUT', body: { opened: true } }).catch(() => {});
            old.joinRoom.call(this, id, name);
        },
        setupSocketListeners() {
            old.setupSocketListeners.call(this);
            this.socket.on('community_changed', safe(this, async () => {
                const [rooms, appearance] = await Promise.all([this.request('/api/rooms'), this.request('/api/preferences')]);
                this.updateRoomList(rooms); this.applyAppearance(appearance); await this.loadSocial(); await this.loadInvitations();
                await this.loadMembers();
            }));
            this.socket.on('message_updated', message => {
                this.messageCache.set(message.id, message);
                const element = Array.from($('messages-container').children).find(item => item.dataset.messageId === message.id);
                if (element) this.decorateMessage(element, message);
            });
            this.socket.on('social_changed', safe(this, () => this.loadInvitations()));
            this.socket.on('group_deleted', data => { if (data.roomId === this.currentRoom) this.joinRoom('default'); });
            this.socket.on('session_revoked', () => { this.socket.disconnect(); location.replace('/'); });
            this.socket.on('room_joined', () => { this.mentionChoices.clear(); this.closeSuggestions(); this.refreshGroupTools(); });
            this.loadInvitations().then(() => {
                const id = new URLSearchParams(location.search).get('invitation');
                const invitation = this.invitations?.find(item => item.id === id);
                if (invitation) this.applyToGroup({ id: invitation.roomId, name: invitation.roomName, ...invitation }, invitation.id);
            }).catch(() => {});
        },
        updateRoomList(rooms) {
            const previous = this.roomData.find(room => room.id === this.currentRoom)?.settings?.clearedThrough;
            old.updateRoomList.call(this, rooms); this.refreshGroupTools(); this.notifications.updateUnread();
            const current = rooms.find(room => room.id === this.currentRoom);
            if (current?.settings?.clearedThrough && current.settings.clearedThrough !== previous) {
                const id = this.currentRoom;
                this.request('/api/rooms/' + id + '/messages').then(list => {
                    if (this.currentRoom !== id) return; $('messages-container').replaceChildren(); for (const item of list.slice(-50)) this.displayMessage(item);
                }).catch(error => this.showToast(error.message));
            }
        },
        refreshGroupTools() {
            const room = this.roomData.find(item => item.id === this.currentRoom);
            const group = room?.kind !== 'direct';
            for (const id of ['essence-btn', 'invite-btn', 'review-btn', 'announcement-section']) $(id).classList.toggle('hidden', !group || id === 'invite-btn' && room?.id === 'default' || id === 'review-btn' && !room?.canManage);
            $('group-announcement').textContent = room?.announcement || '暂无公告';
        },
        renderSocial() { old.renderSocial.call(this); this.renderInvitations(); },
        async loadInvitations() { this.invitations = await this.request('/api/group-invitations'); this.renderInvitations(); },
        renderInvitations() {
            document.querySelectorAll('.group-invitation').forEach(element => element.remove());
            for (const invitation of this.invitations || []) {
                const row = this.makeActionRow($('friend-requests'), invitation.fromName + ' 邀请加入 ' + invitation.roomName, '查看', () => this.applyToGroup({ ...invitation, id: invitation.roomId, name: invitation.roomName }, invitation.id)); row.classList.add('group-invitation');
            }
            const count = this.social.requests.filter(item => item.to === this.currentUserId).length + (this.invitations?.length || 0);
            $('request-count').textContent = count || '';
        },
        renderConversations() {
            const container = $('room-list'); container.replaceChildren();
            const query = $('conversation-search').value.trim().toLowerCase();
            if (this.activeView === 'contacts' && this.contactTab === 'friends') {
                const friends = this.social.friends.filter(person => person.username.toLowerCase().includes(query));
                for (const kind of ['human', 'bot']) {
                    const entries = friends.filter(person => (person.kind || 'human') === kind); if (!entries.length) continue;
                    container.append(E('div', 'list-caption', kind === 'bot' ? 'Bot' : '好友'));
                    for (const person of entries) { const button = E('button', 'contact-item'); button.append(this.avatar(person), E('span', '', person.username)); button.onclick = () => this.showContact(person); container.append(button); }
                }
                if (!friends.length) container.append(E('p', 'empty-state', '暂无好友')); return;
            }
            const rooms = this.roomData.filter(room => room.name.toLowerCase().includes(query) &&
                (this.activeView === 'contacts' ? room.kind !== 'direct' : room.kind !== 'direct' || room.settings?.opened || room.lastMessage));
            rooms.sort((a,b) => Number(!!b.settings?.pinned) - Number(!!a.settings?.pinned) || (b.lastMessage?.timestamp || b.created) - (a.lastMessage?.timestamp || a.created));
            for (const room of rooms) {
                const button = E('button', 'room-item' + (room.id === this.currentRoom && this.activeView === 'chats' ? ' active' : '')); button.dataset.roomId = room.id;
                button.append(this.avatar({ ...room, username: room.name, kind: room.peerKind }));
                const column = E('span', 'conversation-column'); const heading = E('strong', '', room.settings?.remark || room.name); column.append(heading);
                const preview = E('span', 'conversation-preview');
                const mention = this.notifications.mentions.get(room.id);
                if (mention) preview.append(E('span', 'mention-indicator', mention.all ? '[@全体成员] ' : '[@我] '));
                preview.append(document.createTextNode(room.lastMessage?.preview?.replace(/@\{[^}]+\}/g, '@提及').replace(/:qq\[\d+\]:/g, '[表情]') || '暂无消息')); column.append(preview); button.append(column);
                const unread = this.notifications.unread.get(room.id) || 0;
                const muted = room.settings?.notificationMode === 'none' || room.settings?.notificationMode === 'important' && !this.notifications.importantUnread.has(room.id);
                if (unread) button.append(E('span', 'unread-badge' + (muted ? ' muted' : ''), unread > 99 ? '99+' : unread));
                if (room.settings?.pinned) { const pin = E('span', 'conversation-pin'); pin.innerHTML = ChatIcons.svg('pin'); button.append(pin); }
                button.onclick = () => this.activeView === 'contacts' ? this.showGroupContact(room) : this.joinRoom(room.id);
                container.append(button);
            }
        },
        showContact(person) {
            const target = $('contact-profile'); target.replaceChildren(this.avatar(person, true), E('h2', '', person.username), E('p', 'subtle', person.kind === 'bot' ? 'Bot' : person.online ? '在线' : '离线'));
            if (person.about) target.append(E('p', '', person.about));
            target.append(iconButton('chat', '发消息', safe(this, () => this.openDirect(person.id))));
        },
        showGroupContact(room) {
            const target = $('contact-profile'); target.replaceChildren(this.avatar({ ...room, username: room.name }, true), E('h2', '', room.name), E('p', 'subtle', room.memberCount + ' 位成员'));
            target.append(iconButton('chat', '打开群聊', () => this.joinRoom(room.id)));
        },
        updateUserList(members) {
            this.currentMembers = members; const list = $('user-list'); list.replaceChildren();
            $('online-count').textContent = members.length;
            const room = this.roomData.find(item => item.id === this.currentRoom);
            for (const person of members) {
                const row = E('div', 'member-row'); row.append(this.avatar(person), E('span', 'member-name', person.nickname || person.username));
                if (person.groupRole !== 'member' || person.kind === 'bot') {
                    const badge = E('span', 'role-badge'); badge.innerHTML = ChatIcons.svg(person.groupRole === 'owner' ? 'crown' : person.groupRole === 'admin' ? 'shield' : 'bot'); badge.title = person.groupRole === 'owner' ? '群主' : person.groupRole === 'admin' ? '群管理员' : 'Bot'; row.append(badge);
                }
                if (person.kind === 'bot' && person.groupRole !== 'member') { const botBadge = E('span', 'role-badge'); botBadge.innerHTML = ChatIcons.svg('bot'); botBadge.title = 'Bot'; row.append(botBadge); }
                row.oncontextmenu = event => { event.preventDefault(); this.memberMenu(event, person, room); };
                row.onclick = () => { if (person.id !== this.currentUserId) this.memberMenu({ clientX: row.getBoundingClientRect().left, clientY: row.getBoundingClientRect().bottom }, person, room); };
                list.append(row);
            }
        },
        memberMenu(event, person, room) {
            const menu = this.menu(event);
            this.menuItem(menu, 'quote', '提及', () => this.insertMention(person));
            if (person.id !== this.currentUserId) {
                const friend = this.social.friends.some(item => item.id === person.id);
                this.menuItem(menu, friend ? 'chat' : 'invite', friend ? '私聊' : '加好友', () => friend ? this.openDirect(person.id) : this.addFriend(person.id));
                if (room?.groupRole === 'owner') {
                    if (person.groupRole !== 'owner') this.menuItem(menu, 'shield', person.groupRole === 'admin' ? '取消管理' : '设为管理', () => this.request('/api/groups/' + room.id + '/members/' + person.id + '/role', { method: 'PUT', body: { role: person.groupRole === 'admin' ? 'member' : 'admin' } }));
                }
                if (room?.canManage && room.id !== 'default' && person.groupRole !== 'owner' && (room.groupRole === 'owner' || person.groupRole !== 'admin')) this.menuItem(menu, 'close', '移出群组', () => this.request('/api/groups/' + room.id + '/members/' + person.id, { method: 'DELETE' }));
            }
            this.fitMenu(menu);
        },
        enhanceMessage(element, message) { this.messageCache.set(message.id, message); this.decorateMessage(element, message); },
        decorateMessage(element, message) {
            element.querySelectorAll('.message-extra, .message-avatar').forEach(item => item.remove());
            const author = this.currentMembers.find(item => item.id === message.userId), header = element.querySelector('.message-header');
            if (header) header.textContent = (author?.nickname || message.username) + ' · ' + new Date(message.timestamp).toLocaleTimeString();
            element.prepend(this.avatar({ username: message.username, avatar: this.currentMembers.find(item => item.id === message.userId)?.avatar, kind: message.senderKind })); element.firstChild.classList.add('message-avatar');
            if (message.quote) { const quote = E('button', 'message-extra quoted-message', message.quote.username + '：' + message.quote.text.replace(/@\{[^}]+\}/g, '@提及')); quote.onclick = safe(this, () => this.jumpToMessage(message.replyToId)); element.prepend(quote); }
            if (message.senderKind === 'bot') { const marker = E('span', 'message-extra bot-marker'); marker.innerHTML = ChatIcons.svg('bot'); marker.title = 'Bot'; element.append(marker); }
            if (message.essence) { const star = E('span', 'message-extra essence-mark'); star.innerHTML = ChatIcons.svg('star'); star.title = '精华'; element.append(star); }
            if (message.mentions?.some(item => item.type === 'all' || item.userId === this.currentUserId)) element.classList.add('mentions-me');
            const reactions = E('div', 'message-extra reactions');
            for (const reaction of message.reactions || []) {
                const button = E('button', 'reaction-chip' + (reaction.userIds.includes(this.currentUserId) ? ' selected' : ''));
                const image = E('img'); image.src = '/assets/qq/' + reaction.emojiId + '.png'; image.alt = ChatEmoji.find(item => item.id === reaction.emojiId)?.name || '表情';
                button.append(image, document.createTextNode(reaction.userIds.length)); button.onclick = safe(this, () => this.react(message, reaction.emojiId)); reactions.append(button);
            }
            if (reactions.childElementCount) reactions.append(iconButton('smile', '添加回应', () => this.openEmojiPicker(message)));
            element.append(reactions); element.tabIndex = 0; element.onkeydown = event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const rect = element.getBoundingClientRect(); this.messageMenu({ clientX: rect.left, clientY: rect.bottom }, message); } }; element.oncontextmenu = event => { event.preventDefault(); this.messageMenu(event, message); };
        },
        menu(event) { const menu = $('message-menu'); menu.replaceChildren(); menu.classList.remove('hidden'); menu.style.left = event.clientX + 'px'; menu.style.top = event.clientY + 'px'; return menu; },
        fitMenu(menu) { const rect = menu.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8)) + 'px'; menu.style.top = Math.max(8, Math.min(rect.top, innerHeight - rect.height - 8)) + 'px'; },
        menuItem(menu, icon, label, handler) { const button = E('button'); button.setAttribute('role', 'menuitem'); button.innerHTML = ChatIcons.svg(icon); button.append(document.createTextNode(label)); button.onclick = safe(this, async () => { menu.classList.add('hidden'); await handler(); }); menu.append(button); },
        messageMenu(event, message) {
            const menu = this.menu(event), quick = E('div', 'quick-reactions');
            for (const emoji of ChatEmoji.slice(0, 6)) { const button = iconButton('smile', emoji.name, safe(this, () => this.react(message, emoji.id))); button.replaceChildren(this.emojiImage(emoji)); quick.append(button); }
            quick.append(iconButton('plus', '更多回应', () => this.openEmojiPicker(message))); menu.append(quick);
            this.menuItem(menu, 'quote', '引用', () => { this.replyToId = message.id; $('reply-strip').replaceChildren(E('span', '', message.username + '：' + (message.content || message.name || '').slice(0, 100)), iconButton('close', '取消引用', () => this.clearReply())); $('reply-strip').classList.remove('hidden'); $('message-input').focus(); });
            this.menuItem(menu, 'copy', '复制', () => this.copyText(message.content || new URL(message.fileUrl, location.origin).href));
            if (message.fileUrl) this.menuItem(menu, 'download', '下载', () => { const link = E('a'); link.href = message.fileUrl; link.download = message.name; link.click(); });
            const room = this.roomData.find(item => item.id === message.room);
            if (room?.canManage) this.menuItem(menu, 'star', message.essence ? '取消精华' : '设为精华', () => this.request('/api/groups/' + message.room + '/messages/' + message.id + '/essence', { method: 'PUT', body: { enabled: !message.essence } }));
            this.fitMenu(menu);
        },
        async copyText(text) {
            if (navigator.clipboard && isSecureContext) await navigator.clipboard.writeText(text);
            else { const field = E('textarea'); field.value = text; field.className = 'clipboard-field'; ($('app-dialog').open ? $('app-dialog') : document.body).append(field); field.select(); const copied = document.execCommand('copy'); field.remove(); if (!copied) throw new Error('复制失败'); }
            this.showToast('已复制');
        },
        clearReply() { this.replyToId = ''; $('reply-strip').classList.add('hidden'); $('reply-strip').replaceChildren(); },
        async jumpToMessage(id) {
            let target = Array.from($('messages-container').children).find(item => item.dataset.messageId === id);
            if (!target) {
                const list = await this.request('/api/rooms/' + this.currentRoom + '/messages/' + id + '/context');
                $('messages-container').replaceChildren(); for (const item of list) this.displayMessage(item);
                target = Array.from($('messages-container').children).find(item => item.dataset.messageId === id);
            }
            $('app-dialog').close(); target?.scrollIntoView({ block: 'center' }); target?.classList.add('highlighted'); setTimeout(() => target?.classList.remove('highlighted'), 2000);
        },
        async react(message, emojiId) { $('emoji-picker').classList.add('hidden'); $('message-menu').classList.add('hidden'); await this.request('/api/rooms/' + message.room + '/messages/' + message.id + '/reactions', { method: 'PUT', body: { emojiId } }); },
        emojiImage(emoji) { const image = E('img'); image.src = '/assets/qq/' + emoji.id + '.png'; image.alt = emoji.name; image.draggable = false; return image; },
        openEmojiPicker(message) {
            const picker = $('emoji-picker'); picker.replaceChildren(); picker.classList.remove('hidden');
            const input = E('input'); input.placeholder = '搜索表情'; input.setAttribute('aria-label', '搜索表情');
            const categories = E('div', 'emoji-categories'); const grid = E('div', 'emoji-grid'); let category = '全部';
            let recent = []; try { recent = JSON.parse(localStorage.getItem('lantalk_recent_emoji_' + this.currentUserId) || '[]'); } catch {}
            const render = () => { grid.replaceChildren(); const query = input.value.trim().toLowerCase();
                const list = category === '最近' ? recent.map(id => ChatEmoji.find(item => item.id === id)).filter(Boolean) : ChatEmoji;
                for (const emoji of list.filter(item => (category === '全部' || category === '最近' || item.category === category) && (!query || item.name.includes(query) || item.aliases.some(alias => alias.includes(query))))) {
                    const button = E('button'); button.title = emoji.name + ' /' + (emoji.aliases[0] || ''); button.setAttribute('aria-label', emoji.name); button.append(this.emojiImage(emoji));
                    button.onclick = safe(this, async () => {
                        recent = [emoji.id, ...recent.filter(id => id !== emoji.id)].slice(0, 30); try { localStorage.setItem('lantalk_recent_emoji_' + this.currentUserId, JSON.stringify(recent)); } catch {}
                        if (message) await this.react(message, emoji.id); else { this.insertText(':qq[' + emoji.id + ']:'); picker.classList.add('hidden'); }
                    }); grid.append(button);
                }
            };
            for (const label of ['全部', '最近', '经典', '更多']) { const button = E('button', '', label); button.onclick = () => { category = label; render(); }; categories.append(button); }
            input.oninput = render; picker.append(input, categories, grid); render(); input.focus();
        },
        insertText(text, start, end) { const input = $('message-input'); if (input.disabled) return; input.setRangeText(text, start ?? input.selectionStart, end ?? input.selectionEnd, 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); },
        insertMention(person, start, end) {
            const key = person.type === 'all' ? 'all' : person.id;
            const input = $('message-input'), at = start ?? input.selectionStart, label = person.username || '全体成员';
            this.insertText('@' + label + ' ', at, end ?? input.selectionEnd);
            this.mentionChoices.set(String(Date.now()) + ':' + at, { type: key === 'all' ? 'all' : 'user', ...(key === 'all' ? {} : { userId: key }), label, start: at, end: at + label.length + 1 });
            input.dispatchEvent(new Event('input', { bubbles: true })); this.closeSuggestions();
        },
        draftMentions() { const value = $('message-input').value; return [...this.mentionChoices.values()].filter(item => value.slice(item.start, item.end) === '@' + item.label && MessagePolicy.plainMentionAt(value, item.start, item.end)); },
        closeSuggestions() { this.suggestions = []; $('input-suggestions').classList.add('hidden'); $('message-input').setAttribute('aria-expanded', 'false'); $('message-input').removeAttribute('aria-activedescendant'); },
        initializeSuggestions() {
            const input = $('message-input');
            let previous = input.value;
            input.addEventListener('input', () => {
                const next = input.value;
                let prefix = 0, suffix = 0;
                while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
                while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
                const oldEnd = previous.length - suffix, delta = next.length - previous.length;
                if (next !== previous) for (const [key, entity] of this.mentionChoices) {
                    if (entity.end <= prefix) continue;
                    if (entity.start >= oldEnd) { entity.start += delta; entity.end += delta; }
                    else this.mentionChoices.delete(key);
                }
                previous = next;
            });
            input.setAttribute('aria-controls', 'input-suggestions'); input.setAttribute('aria-autocomplete', 'list');
            let composing = false;
            input.addEventListener('compositionstart', () => { composing = true; this.closeSuggestions(); }); input.addEventListener('compositionend', () => { composing = false; });
            const refresh = () => {
                if (composing || input.disabled) return this.closeSuggestions();
                const before = input.value.slice(0, input.selectionStart), match = before.match(/(?:^|\s)([@/])([^\s@/{}:]*)$/);
                // Fences and inline code/math must not open completion menus.
                const fences = (before.match(/^\s*```/gm) || []).length;
                const line = before.split('\n').at(-1);
                if (!match || fences % 2 || (line.match(/`/g) || []).length % 2 || (line.match(/\$/g) || []).length % 2) return this.closeSuggestions();
                const query = match[2].toLowerCase(), type = match[1];
                const room = this.roomData.find(item => item.id === this.currentRoom);
                const people = [...this.currentMembers]; if (room?.canManage && room.kind !== 'direct') people.unshift({ type: 'all', username: '全体成员' });
                const candidates = type === '/' ? ChatEmoji.filter(item => !query || item.name.includes(query) || item.aliases.some(alias => alias.startsWith(query))) : people.filter(item => !query || (item.nickname || item.username).toLowerCase().includes(query) || item.username.toLowerCase().includes(query));
                this.suggestions = candidates.slice(0, 8); this.suggestionIndex = 0; this.suggestionStart = before.length - match[2].length - 1; this.suggestionEnd = input.selectionStart; this.suggestionType = type;
                this.renderSuggestions();
            };
            input.addEventListener('input', refresh); input.addEventListener('click', refresh);
            input.addEventListener('keydown', event => {
                if (event.isComposing || composing || !this.suggestions?.length || event.ctrlKey || event.metaKey) return;
                if (event.key === 'Escape') { event.preventDefault(); this.closeSuggestions(); }
                else if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); this.suggestionIndex = (this.suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + this.suggestions.length) % this.suggestions.length; this.renderSuggestions(); }
                else if (['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); this.chooseSuggestion(this.suggestionIndex); }
            }, true);
            input.addEventListener('message-sent', () => { this.mentionChoices.clear(); this.closeSuggestions(); });
        },
        renderSuggestions() {
            const panel = $('input-suggestions'); panel.replaceChildren(); panel.classList.toggle('hidden', !this.suggestions.length);
            $('message-input').setAttribute('aria-expanded', String(!!this.suggestions.length));
            this.suggestions.forEach((item, index) => {
                const button = E('button', index === this.suggestionIndex ? 'selected' : ''); button.type = 'button'; button.id = 'suggestion-' + index; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(index === this.suggestionIndex));
                if (this.suggestionType === '/') button.append(this.emojiImage(item), document.createTextNode(item.name + ' /' + (item.aliases[0] || '')));
                else button.append(this.avatar(item), document.createTextNode('@' + (item.nickname || item.username)));
                button.onmousedown = event => event.preventDefault(); button.onclick = () => this.chooseSuggestion(index); panel.append(button);
            });
            if (this.suggestions.length) $('message-input').setAttribute('aria-activedescendant', 'suggestion-' + this.suggestionIndex);
        },
        chooseSuggestion(index) { const item = this.suggestions[index]; if (!item) return; if (this.suggestionType === '@') this.insertMention(item, this.suggestionStart, this.suggestionEnd); else { this.insertText(':qq[' + item.id + ']: ', this.suggestionStart, this.suggestionEnd); this.closeSuggestions(); } },
        dialog(title) { const dialog = $('app-dialog'); $('dialog-title').textContent = title; $('dialog-body').replaceChildren(); if (!dialog.open) dialog.showModal(); return $('dialog-body'); },
        field(form, label, value = '', type = 'text') { const wrap = E('label', 'form-field', label); const input = E(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type; if (type === 'checkbox') input.checked = !!value; else input.value = value; wrap.append(input); form.append(wrap); return input; },
        selectField(form, label, options, value) { const wrap = E('label', 'form-field', label), select = E('select'); select.setAttribute('aria-label', label); for (const [id, name] of options) { const option = E('option', '', name); option.value = id; select.append(option); } select.value = value; wrap.append(select); form.append(wrap); return select; },
        submit(form, label, handler) { const button = E('button', 'primary', label); button.type = 'submit'; form.append(button); form.onsubmit = async event => { event.preventDefault(); button.disabled = true; try { await handler(); } catch (error) { this.showToast(error.message); } finally { button.disabled = false; } }; },
        questionsEditor(form, initial = []) {
            const block = E('fieldset', 'question-editor'), legend = E('legend', '', '入群问题'); block.append(legend); form.append(block);
            const rows = [];
            const add = (question = '', answer = '') => { const row = E('div', 'question-row'); const q = this.field(row, '问题', question), a = this.field(row, '标准答案（自动校验时使用）', answer); const item = { row, q, a }; rows.push(item); row.append(iconButton('close', '删除问题', () => { row.remove(); rows.splice(rows.indexOf(item), 1); })); block.append(row); };
            for (const item of initial) add(item.question, item.answer);
            block.append(iconButton('plus', '添加问题', () => { if (rows.length < 8) add(); }));
            return () => rows.map(item => ({ question: item.q.value, answer: item.a.value }));
        },
        editGroup(room) {
            const body = this.dialog(room ? '编辑群组' : '创建群组'), form = E('form', 'settings-form');
            const name = this.field(form, '群名称', room?.name || ''); name.required = true; name.maxLength = 50;
            const visibility = this.selectField(form, '可见性', [['public', '公开'], ['private', '私有']], room?.isPublic === false ? 'private' : 'public');
            const mode = this.selectField(form, '入群方式', [['open', '直接加入'], ['answer', '回答正确自动加入'], ['review', '群管理审核']], room?.joinMode || 'open');
            const questions = this.questionsEditor(form, room?.managementQuestions || []);
            this.submit(form, '保存', async () => {
                const result = await this.request('/api/groups' + (room ? '/' + room.id : ''), { method: room ? 'PUT' : 'POST', body: { name: name.value, isPublic: visibility.value === 'public', joinMode: mode.value, questions: questions() } });
                $('app-dialog').close(); this.joinRoom(result.room.id);
            }); body.append(form);
        },
        async discoverGroups() {
            const body = this.dialog('查找群组'), form = E('form', 'inline-form'), query = E('input'), list = E('div'); query.placeholder = '群名称或 ID'; query.setAttribute('aria-label', '群名称或 ID'); form.append(query); this.submit(form, '搜索', () => load()); body.append(form, list);
            const load = async () => { const groups = await this.request('/api/groups?q=' + encodeURIComponent(query.value)); list.replaceChildren(); for (const room of groups) this.makeActionRow(list, room.name + ' · ' + room.memberCount, room.joined ? '打开' : '加入', () => room.joined ? (this.joinRoom(room.id), $('app-dialog').close()) : this.applyToGroup(room)); if (!groups.length) list.textContent = '暂无结果'; }; await load();
        },
        applyToGroup(room, invitationId) {
            const body = this.dialog('加入 ' + (room.name || room.roomName)), form = E('form', 'settings-form');
            const answers = (room.questions || []).map(question => this.field(form, question));
            if (room.joinMode === 'review') form.append(E('p', 'subtle', '提交后由群管理审核'));
            this.submit(form, '提交', async () => { const result = await this.request('/api/groups/' + room.id + '/join', { method: 'POST', body: { invitationId, answers: answers.map(input => input.value) } }); $('app-dialog').close(); if (result.pending) this.showToast('已提交申请'); else this.joinRoom(result.room.id); await this.loadInvitations(); }); body.append(form);
        },
        async inviteFriends() {
            const body = this.dialog('邀请好友'), room = this.roomData.find(item => item.id === this.currentRoom);
            const members = await this.request('/api/rooms/' + room.id + '/members');
            for (const friend of this.social.friends.filter(item => !members.some(member => member.id === item.id))) this.makeActionRow(body, friend.username, '邀请', async () => { const data = await this.request('/api/groups/' + room.id + '/invitations', { method: 'POST', body: { userId: friend.id } }); this.showToast('邀请已发送'); await this.copyText(new URL(data.link, location.origin).href); });
            if (!body.childElementCount) body.textContent = '暂无可邀请好友';
        },
        async reviewApplications() {
            const room = this.currentRoom, list = await this.request('/api/groups/' + room + '/applications'), body = this.dialog('入群审核');
            if (!list.length) body.textContent = '暂无申请';
            for (const item of list) {
                const row = E('section', 'application'); row.append(E('strong', '', item.user.username));
                for (const answer of item.answers) row.append(E('p', '', answer));
                for (const [action, label] of [['accept', '通过'], ['reject', '拒绝']]) { const button = E('button', '', label); button.onclick = safe(this, async () => { await this.request('/api/groups/' + room + '/applications/' + item.id, { method: 'PUT', body: { action } }); row.remove(); }); row.append(button); } body.append(row);
            }
        },
        async openChatSettings() {
            const room = this.roomData.find(item => item.id === this.currentRoom); if (!room) return;
            const details = room.kind === 'direct' ? room : await this.request('/api/groups/' + room.id);
            const body = this.dialog('会话设置'), form = E('form', 'settings-form');
            const nickname = room.kind !== 'direct' ? this.field(form, '群昵称', room.settings.nickname) : null;
            const remark = this.field(form, '备注', room.settings.remark), pinned = this.field(form, '置顶', room.settings.pinned, 'checkbox');
            const mode = this.selectField(form, '消息通知', [['none', '完全免打扰'], ['important', '仅重要消息'], ['all', '全部提醒']], room.settings.notificationMode);
            form.append(E('p', 'subtle', '重要消息：群主、群管理员发言，以及 @我、@全体。完全免打扰保留灰色未读数和提及标记。'));
            this.submit(form, '保存', async () => { await this.request('/api/rooms/' + room.id + '/settings', { method: 'PUT', body: { ...(nickname ? { nickname: nickname.value } : {}), remark: remark.value, pinned: pinned.checked, notificationMode: mode.value } }); $('app-dialog').close(); }); body.append(form);
            const clear = E('button', 'danger', '清空我的记录'); clear.onclick = safe(this, async () => { if (confirm('仅清空自己的记录显示，其他成员不受影响。')) { await this.request('/api/rooms/' + room.id + '/settings', { method: 'PUT', body: { clear: true } }); $('messages-container').replaceChildren(); this.notifications.markRead(); $('app-dialog').close(); } }); body.append(clear);
            if (room.kind === 'direct') {
                const friendship = E('button', room.canSend ? 'danger' : '', room.canSend ? '删除好友' : '重新加好友');
                friendship.onclick = safe(this, async () => {
                    if (room.canSend) { if (!confirm('删除好友后保留历史，不能再发送新消息。')) return; await this.request('/api/friends/' + room.peerId, { method: 'DELETE' }); }
                    else await this.addFriend(room.peerId);
                    $('app-dialog').close();
                }); body.append(friendship);
            }
            if (room.canManage) {
                const announcement = E('form', 'settings-form'); const input = this.field(announcement, '群公告', details.announcement, 'textarea'); this.submit(announcement, '保存公告', async () => { await this.request('/api/groups/' + room.id, { method: 'PUT', body: { announcement: input.value } }); this.showToast('已保存'); }); body.append(announcement);
                this.avatarControl(body, '/api/groups/' + room.id + '/avatar');
            }
            if (room.groupRole === 'owner') {
                const edit = E('button', '', '编辑群组'); edit.onclick = () => this.editGroup(details); body.append(edit);
                const people = this.currentMembers.filter(person => person.kind !== 'bot' && person.id !== this.currentUserId);
                if (people.length) { const transfer = E('form', 'settings-form'), choice = this.selectField(transfer, '转让群主', people.map(person => [person.id, person.username]), people[0].id); this.submit(transfer, '转让', async () => { if (confirm('转让后你将成为普通成员。')) { await this.request('/api/groups/' + room.id + '/owner', { method: 'PUT', body: { userId: choice.value } }); $('app-dialog').close(); } }); body.append(transfer); }
                const disband = E('button', 'danger', '解散群组'); disband.onclick = safe(this, async () => { if (confirm('解散此群组？')) { await this.request('/api/groups/' + room.id, { method: 'DELETE' }); $('app-dialog').close(); this.joinRoom('default'); } }); body.append(disband);
            } else if (room.kind !== 'direct' && room.id !== 'default') { const leave = E('button', 'danger', '退出群组'); leave.onclick = safe(this, async () => { await this.request('/api/groups/' + room.id + '/leave', { method: 'POST' }); $('app-dialog').close(); this.joinRoom('default'); }); body.append(leave); }
        },
        renderConversationActions() { $('conversation-actions').replaceChildren(); },
        async openProfile() { const body = this.dialog('个人资料'); body.append(this.avatar(this.account, true), E('h3', '', this.currentUser)); this.avatarControl(body, '/api/me/avatar', async avatar => { this.account.avatar = avatar; $('profile-btn').replaceChildren(this.avatar(this.account)); }); },
        avatarControl(body, url, callback) {
            const input = E('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg'; input.setAttribute('aria-label', '上传头像');
            input.onchange = safe(this, async () => { const file = input.files[0]; if (!file) return; const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + this.authToken }, body: file }); const data = await response.json(); if (!response.ok) throw new Error(data.error); callback?.(data.avatar); this.showToast('头像已更新'); });
            const reset = E('button', '', '重置头像'); reset.onclick = safe(this, async () => { const data = await this.request(url, { method: 'DELETE' }); callback?.(data.avatar); this.showToast('头像已重置'); }); body.append(input, reset);
        },
        renderFilePanel(files) { this.fileData = files; old.renderFilePanel.call(this, files); },
        async openFiles() { await this.loadFilePanel(); const body = this.dialog('文件'); for (const file of this.fileData || []) { const row = E('div', 'file-entry'); row.append(E('strong', '', file.name), E('p', 'subtle', this.formatSize(file.size))); if (!file.expired) { const link = E('a', '', '下载'); link.href = file.url; link.download = file.name; row.append(link); } else row.append(E('span', 'subtle', '已过期')); body.append(row); } if (!body.childElementCount) body.textContent = '暂无文件'; },
        async openEssence() { const list = await this.request('/api/groups/' + this.currentRoom + '/essence'); this.messageResults(this.dialog('精华'), list); },
        messageResults(container, list) { container.replaceChildren(); if (!list.length) container.textContent = '暂无结果'; for (const message of list) this.makeActionRow(container, message.username + '：' + (message.content || message.name || '').slice(0, 160), '定位', () => this.jumpToMessage(message.id)); },
        openSearch() {
            const body = this.dialog('搜索记录'), form = E('form', 'settings-form'), results = E('div');
            const q = this.field(form, '关键词'), user = this.selectField(form, '发送者', [['', '全部'], ...this.currentMembers.map(person => [person.id, person.nickname || person.username])], '');
            const type = this.selectField(form, '类型', [['', '全部'], ['text', '文字'], ['image', '图片'], ['file', '文件']], '');
            const from = this.field(form, '起始日期', '', 'date'), to = this.field(form, '结束日期', '', 'date');
            this.submit(form, '搜索', async () => { const params = new URLSearchParams({ q: q.value, userId: user.value, type: type.value }); if (from.value) params.set('from', String(new Date(from.value + 'T00:00:00').getTime())); if (to.value) params.set('to', String(new Date(to.value + 'T23:59:59.999').getTime())); this.messageResults(results, await this.request('/api/rooms/' + this.currentRoom + '/search?' + params)); }); body.append(form, results);
        }
    });
})();
