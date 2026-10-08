(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.ChatNotifications = factory(root);
})(typeof globalThis === 'object' ? globalThis : this, function (window) {
    'use strict';
    const document = window.document;
    return class ChatNotifications {
        constructor({ currentUser, currentRoom, roomName, isViewingChat, openRoom, onUnread, onHint }) {
            Object.assign(this, { currentUser, currentRoom, roomName, isViewingChat, openRoom, onUnread, onHint });
            this.enabled = this.readPreference();
            this.unread = new Map();
            this.seen = new Set();
            this.active = new Map();
            this.baseTitle = document.title;
            this.nativeFailed = false;
            const refresh = () => { this.markRead(); this.updateButton(); };
            window.addEventListener('focus', refresh);
            document.addEventListener('visibilitychange', refresh);
            window.addEventListener('storage', event => {
                if (event.key === 'lantalk_notify') { this.enabled = this.readPreference(); this.updateButton(); this.updateUnread(); }
            });
            // Permission can also change through the browser's site settings.
            if (typeof window.navigator.permissions?.query === 'function') {
                try {
                    window.navigator.permissions.query({ name: 'notifications' }).then(status => {
                        status.addEventListener('change', () => this.updateButton());
                    }).catch(() => {});
                } catch {}
            }
            this.updateButton();
        }
        readPreference() {
            try { return window.localStorage.getItem('lantalk_notify') === 'on'; } catch { return false; }
        }
        nativeAvailable() {
            return window.isSecureContext && typeof window.Notification === 'function';
        }
        nativeReady() {
            return this.nativeAvailable() && window.Notification.permission === 'granted' && !this.nativeFailed;
        }
        fallbackReason() {
            if (!window.isSecureContext) return '此地址无法使用系统通知，请改用 HTTPS 或 localhost；仍可显示未读提醒。';
            if (typeof window.Notification !== 'function') return '当前浏览器不支持系统通知，仍可显示未读提醒。';
            if (window.Notification.permission === 'denied') return '系统通知被浏览器阻止，请在站点权限中允许；仍可显示未读提醒。';
            if (this.nativeFailed) return '系统通知暂时不可用，仍可显示未读提醒。';
            return '尚未授予系统通知权限，仍可显示未读提醒。';
        }
        async toggle() {
            if (this.requesting) return;
            if (this.enabled) this.enabled = false;
            else {
                this.enabled = true;
                this.nativeFailed = false;
                if (this.nativeAvailable() && window.Notification.permission === 'default') {
                    this.requesting = true;
                    try { await window.Notification.requestPermission(); }
                    catch { this.nativeFailed = true; }
                    finally { this.requesting = false; }
                }
            }
            try { window.localStorage.setItem('lantalk_notify', this.enabled ? 'on' : 'off'); } catch {}
            this.updateButton();
            this.updateUnread();
            this.onHint(this.enabled ? (this.nativeReady() ? '消息通知已开启，离开当前聊天窗口后会提醒。' : this.fallbackReason()) : '消息提醒已关闭，房间未读数仍会保留。');
        }
        updateButton() {
            const button = document.getElementById('notify-btn');
            if (!button) return;
            button.classList.toggle('enabled', this.enabled);
            button.setAttribute('aria-pressed', String(this.enabled));
            button.textContent = this.enabled ? (this.nativeReady() ? '通知已开启' : '未读提醒') : '开启通知';
            button.title = this.enabled ? (this.nativeReady() ? '关闭系统通知' : this.fallbackReason() + ' 点击关闭。') : '开启消息通知';
        }
        viewingRoom(room) {
            return !document.hidden && document.hasFocus() && this.isViewingChat() && room === this.currentRoom();
        }
        updateUnread() {
            const count = Array.from(this.unread.values()).reduce((sum, value) => sum + value, 0);
            document.title = this.enabled && count ? `(${count}) ${this.baseTitle}` : this.baseTitle;
            this.onUnread(this.unread);
        }
        markRead() {
            const room = this.currentRoom();
            if (!this.viewingRoom(room)) return;
            this.unread.delete(room);
            for (const [id, item] of this.active) {
                if (item.room === room) { item.notification.close(); this.active.delete(id); }
            }
            this.updateUnread();
        }
        pruneRooms(ids) {
            const allowed = new Set(ids);
            for (const room of this.unread.keys()) if (!allowed.has(room)) this.unread.delete(room);
            for (const [id, item] of this.active) {
                if (!allowed.has(item.room)) { item.notification.close(); this.active.delete(id); }
            }
            this.updateUnread();
        }
        body(message) {
            if (message.type === 'file') return `${message.isImage ? '图片' : '文件'}：${message.name || '附件'}`;
            let text = message.content || '';
            if (message.processedContent) {
                const template = document.createElement('template');
                template.innerHTML = message.processedContent;
                text = template.content.textContent;
            }
            return text.replace(/\s+/g, ' ').trim().slice(0, 120);
        }
        receive(message) {
            if (!message || !['text', 'file', 'admin'].includes(message.type) || message.username === this.currentUser()) return;
            if (message.id && this.seen.has(message.id)) return;
            if (message.id) {
                this.seen.add(message.id);
                if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value);
            }
            const room = message.room || this.currentRoom();
            if (this.viewingRoom(room)) return;
            this.unread.set(room, (this.unread.get(room) || 0) + 1);
            this.updateUnread();
            // Other rooms retain unread counts; desktop alerts appear only outside this window.
            if (!this.enabled || !this.nativeReady() || (!document.hidden && document.hasFocus())) return;
            this.showNative(message, room).catch(() => {});
        }
        async showNative(message, room) {
            const display = () => {
                if (!this.enabled || !this.nativeReady() || this.viewingRoom(room) || !this.unread.has(room)) return;
                const key = 'lantalk_native_' + this.currentUser();
                let recent = [];
                try {
                    const saved = JSON.parse(window.localStorage.getItem(key) || '[]');
                    if (Array.isArray(saved)) recent = saved.filter(item => item && item.time > Date.now() - 120000);
                } catch {}
                if (message.id && recent.some(item => item.id === message.id)) return;
                try {
                    const notification = new window.Notification(`${message.username} · ${this.roomName(room)}`, {
                        body: this.body(message), tag: message.id || undefined
                    });
                    if (message.id) {
                        recent.push({ id: message.id, time: Date.now() });
                        try { window.localStorage.setItem(key, JSON.stringify(recent.slice(-100))); } catch {}
                    }
                    const id = message.id || notification;
                    this.active.set(id, { notification, room });
                    notification.onclose = () => this.active.delete(id);
                    notification.onclick = () => {
                        window.focus();
                        this.openRoom(room);
                        notification.close();
                        this.active.delete(id);
                    };
                } catch {
                    this.nativeFailed = true;
                    this.updateButton();
                }
            };
            // Secure desktop browsers share a lock to avoid duplicate alerts from several tabs.
            if (window.navigator.locks && message.id) {
                try { await window.navigator.locks.request('lantalk_notification_' + this.currentUser() + '_' + message.id, display); }
                catch { display(); }
            } else display();
        }
    };
});
