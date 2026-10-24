        const adminAPI = {
            token() {
                const raw = localStorage.getItem('lantalk_auth') || sessionStorage.getItem('lantalk_auth');
                try { return raw ? JSON.parse(raw).token : null; } catch (e) { return null; }
            },
            origin() {
                const raw = localStorage.getItem('lantalk_auth') || sessionStorage.getItem('lantalk_auth');
                return location.origin;
            },
            async request(path, options = {}) {
                const resp = await fetch(this.origin() + path, {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        ...(this.token() ? { 'Authorization': 'Bearer ' + this.token() } : {})
                    }
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
                return data;
            },
            refreshAll() {
                this.loadStatus();
                this.loadConfig();
                this.loadRooms();
                this.loadAccounts();
                this.loadOnline();
                this.loadMuted();
                this.loadDevices();
                this.loadBots();
            },
            async loadStatus() {
                try {
                    const data = await fetch(this.origin() + '/api/health').then(r => r.json());
                    document.getElementById('server-status').innerHTML = `
                        <p>✅ 服务器运行正常</p>
                        <p>在线用户: <strong>${data.users}</strong> | 房间: <strong>${data.rooms}</strong> | 被禁言IP: <strong>${data.mutedIPs}</strong></p>
                        <p>服务器IP: <strong>${data.serverIP}</strong></p>`;
                } catch (e) {
                    document.getElementById('server-status').textContent = '❌ 无法连接服务器';
                }
            },
            async loadConfig() {
                try {
                    const cfg = await this.request('/api/config');
                    document.getElementById('current-port').textContent = cfg.port;
                    document.getElementById('jiyu-enabled').checked = cfg.jiyuEnabled;
                    document.getElementById('jiyu-port').value = cfg.jiyuPort;
                    document.getElementById('current-max-file').textContent = cfg.maxFileMB;
                    document.getElementById('current-max-uploads').textContent = cfg.maxUploadsMB;
                    document.getElementById('current-server-ip').textContent = cfg.localIP;
                    document.getElementById('detected-ip').textContent = cfg.serverIP
                        ? `（手动指定；自动检测为 ${cfg.detectedIP}）`
                        : '（自动检测）';
                } catch (e) {}
            },
            async savePort() {
                const p = document.getElementById('new-port').value.trim();
                try {
                    const r = await this.request('/api/config', { method: 'PUT', body: JSON.stringify({ port: p }) });
                    alert('✅ ' + r.message);
                    this.loadConfig();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async saveServerIP() {
                const ip = document.getElementById('new-server-ip').value.trim();
                try {
                    const r = await this.request('/api/config', { method: 'PUT', body: JSON.stringify({ serverIP: ip }) });
                    alert('✅ ' + r.message);
                    document.getElementById('new-server-ip').value = '';
                    this.loadConfig();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async saveFileLimits() {
                const body = {};
                const mf = document.getElementById('new-max-file').value.trim();
                const mu = document.getElementById('new-max-uploads').value.trim();
                if (mf) body.maxFileMB = mf;
                if (mu) body.maxUploadsMB = mu;
                if (!Object.keys(body).length) return alert('请输入要修改的数值');
                try {
                    const r = await this.request('/api/config', { method: 'PUT', body: JSON.stringify(body) });
                    alert('✅ ' + r.message);
                    document.getElementById('new-max-file').value = '';
                    document.getElementById('new-max-uploads').value = '';
                    this.loadConfig();
                } catch (e) { alert('❌ ' + e.message); }
            },
            row(label, metadata) {
                const row = document.createElement('div');
                row.className = 'admin-item';
                const info = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = label;
                const meta = document.createElement('span');
                meta.className = 'admin-meta';
                meta.textContent = ' ' + metadata;
                info.append(title, meta);
                const actions = document.createElement('div');
                row.append(info, actions);
                return { row, actions };
            },
            button(actions, label, callback, style = 'secondary') {
                const button = document.createElement('button');
                button.className = style;
                button.textContent = label;
                button.addEventListener('click', callback);
                actions.appendChild(button);
            },
            async loadRooms() {
                try {
                    const list = await this.request('/api/rooms?manage=1'), container = document.getElementById('admin-rooms-list'); container.replaceChildren();
                    for (const room of list) {
                        const { row, actions } = this.row(room.name, `${room.isPublic ? '公开' : '私有'} · ${room.memberCount} 位成员`);
                        if (room.id !== 'default') this.button(actions, '强制解散', async () => {
                            if (confirm('强制解散 ' + room.name + '？')) { await this.request('/api/groups/' + room.id, { method: 'DELETE' }); this.loadRooms(); }
                        }, 'danger'); container.append(row);
                    }
                } catch(error) { document.getElementById('admin-rooms-list').textContent = error.message; }
            },
            async loadAccounts() {
                try {
                    const accounts = await this.request('/api/accounts');
                    const el = document.getElementById('admin-accounts-list');
                    el.replaceChildren();
                    const me = window.chatApp;
                    for (const account of accounts.filter(account => account.kind !== 'bot')) {
                        const roleName = { superadmin: '超级管理员', admin: '管理员', user: '普通用户' }[account.role];
                        const { row, actions } = this.row(account.username, `${roleName} | 关联IP: ${account.boundIp || '尚未首次登录'}`);
                        const editable = me.userRole === 'superadmin' || account.role === 'user' || account.username === me.currentUser;
                        if (editable) {
                            this.button(actions, '改名', () => this.renameUser(account.username));
                            this.button(actions, '重置密码', () => this.resetPassword(account.username));
                            this.button(actions, '解绑 IP', () => this.bindIP(account, null));
                            this.button(actions, '换绑 IP', () => { const ip = prompt('新 IP（该账号所有会话将失效）', account.boundIp || ''); if (ip) this.bindIP(account, ip); });
                        }
                        if (me.userRole === 'superadmin' && account.role !== 'superadmin') {
                            this.button(actions, account.role === 'admin' ? '取消管理员' : '设为管理员', () => this.setRole(account.username, account.role === 'admin' ? 'user' : 'admin'));
                        }
                        if (editable && account.role !== 'superadmin' && account.username !== me.currentUser) this.button(actions, '删除', () => this.deleteUser(account.username), 'danger');
                        el.appendChild(row);
                    }
                } catch (e) { document.getElementById('admin-accounts-list').textContent = '❌ ' + e.message; }
            },
            async setRole(username, role) {
                try {
                    await this.request(`/api/users/${encodeURIComponent(username)}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
                    this.loadAccounts();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async renameUser(username) {
                const newUsername = prompt(`将 "${username}" 改名为：`, username);
                if (!newUsername || newUsername === username) return;
                try {
                    const r = await this.request('/api/users/' + encodeURIComponent(username), { method: 'PUT', body: JSON.stringify({ newUsername }) });
                    alert('✅ ' + r.message);
                    this.loadAccounts();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async resetPassword(username) {
                const newPassword = prompt(`为 "${username}" 设置新密码（至少6位）：`);
                if (!newPassword) return;
                try {
                    const r = await this.request('/api/users/' + encodeURIComponent(username), { method: 'PUT', body: JSON.stringify({ newPassword }) });
                    alert('✅ ' + r.message);
                } catch (e) { alert('❌ ' + e.message); }
            },
            async deleteUser(username) {
                if (!confirm(`确定删除账号 "${username}" ？`)) return;
                try {
                    const r = await this.request('/api/users/' + encodeURIComponent(username), { method: 'DELETE' });
                    alert('✅ ' + r.message);
                    this.loadAccounts();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async loadOnline() {
                try {
                    const users = await this.request('/api/users');
                    const el = document.getElementById('admin-online-list');
                    el.innerHTML = users.length ? users.map(u => `
                        <div class="admin-item">
                            <div><strong>${window.chatApp.escapeHtml(u.username)}</strong> <span class="admin-meta">IP: ${u.ip}${u.isMuted ? ' | <span class="muted-tag">已禁言</span>' : ''}</span></div>
                            <div>
                                <button class="danger" onclick="adminAPI.muteIPByIp('${u.ip}')" ${u.isMuted ? 'disabled' : ''}>禁言</button>
                                <button class="success" onclick="adminAPI.unmuteIPByIp('${u.ip}')" ${!u.isMuted ? 'disabled' : ''}>解禁</button>
                            </div>
                        </div>`).join('') : '<div class="admin-meta">暂无在线用户</div>';
                } catch (e) { document.getElementById('admin-online-list').textContent = '❌ ' + e.message; }
            },
            async loadMuted() {
                try {
                    const ips = await this.request('/api/muted-ips');
                    const el = document.getElementById('admin-muted-list');
                    el.innerHTML = ips.length ? ips.map(ip => `
                        <div class="admin-item">
                            <span>${ip}</span>
                            <button class="success" onclick="adminAPI.unmuteIPByIp('${ip}')">解除禁言</button>
                        </div>`).join('') : '<div class="admin-meta">暂无被禁言的IP</div>';
                } catch (e) {}
            },
            async muteIP() {
                const ip = document.getElementById('admin-ip-input').value.trim();
                if (!ip) return alert('请输入IP地址');
                try {
                    const r = await this.request('/api/mute-ip', { method: 'POST', body: JSON.stringify({ ip }) });
                    alert('✅ ' + r.message);
                    this.loadMuted();
                    this.loadOnline();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async unmuteIP() {
                const ip = document.getElementById('admin-ip-input').value.trim();
                if (!ip) return alert('请输入IP地址');
                try {
                    const r = await this.request('/api/unmute-ip', { method: 'POST', body: JSON.stringify({ ip }) });
                    alert('✅ ' + r.message);
                    this.loadMuted();
                    this.loadOnline();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async muteIPByIp(ip) {
                try {
                    const r = await this.request('/api/mute-ip', { method: 'POST', body: JSON.stringify({ ip }) });
                    alert('✅ ' + r.message);
                    this.loadMuted();
                    this.loadOnline();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async unmuteIPByIp(ip) {
                try {
                    const r = await this.request('/api/unmute-ip', { method: 'POST', body: JSON.stringify({ ip }) });
                    alert('✅ ' + r.message);
                    this.loadMuted();
                    this.loadOnline();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async saveJiyu() {
                try {
                    await this.request('/api/config', { method: 'PUT', body: JSON.stringify({
                        jiyuEnabled: document.getElementById('jiyu-enabled').checked,
                        jiyuPort: Number(document.getElementById('jiyu-port').value)
                    }) }); alert('设置已保存'); this.loadConfig();
                } catch(e) { alert(e.message); }
            },
            async loadDevices() {
                try {
                    const devices = await this.request('/api/jiyu/devices');
                    const container = document.getElementById('jiyu-devices'); container.replaceChildren();
                    for (const device of devices) {
                        const { row, actions } = this.row(device.username, device.ip || '尚未首次登录，无通知地址');
                        if (device.ip) this.button(actions, '测试通知', async () => {
                            try { const result = await this.request('/api/jiyu/test', { method: 'POST', body: JSON.stringify({ userId: device.userId }) }); alert(result.message); }
                            catch(e) { alert(e.message); }
                        });
                        container.append(row);
                    }
                } catch(e) { document.getElementById('jiyu-devices').textContent = e.message; }
            },
            async broadcast() {
                const message = document.getElementById('admin-broadcast').value.trim();
                if (!message) return alert('请输入广播内容');
                try {
                    const r = await this.request('/api/broadcast', { method: 'POST', body: JSON.stringify({ message }) });
                    alert('✅ ' + r.message);
                    document.getElementById('admin-broadcast').value = '';
                } catch (e) { alert('❌ ' + e.message); }
            }
        };


Object.assign(adminAPI, {
    async bindIP(account, ip) {
        if (!confirm(ip ? '换绑后该账号需要从新 IP 重新登录。' : '解绑后该账号下次登录将绑定当时的来源 IP。继续？')) return;
        try { await this.request('/api/accounts/' + account.id + '/ip-binding', { method: 'PUT', body: JSON.stringify({ ip }) }); this.loadAccounts(); this.loadDevices(); }
        catch(error) { alert(error.message); }
    },
    showBotToken(token) { const output = document.getElementById('bot-token'); output.hidden = false; output.textContent = token; },
    async createBot() {
        const username = prompt('Bot 名称（2–20 字符）'); if (!username) return;
        try { const data = await this.request('/api/bots', { method: 'POST', body: JSON.stringify({ username }) }); this.showBotToken(data.token); this.loadBots(); }
        catch(error) { alert(error.message); }
    },
    async loadBots() {
        try {
            const list = await this.request('/api/bots'), container = document.getElementById('admin-bots-list'); container.replaceChildren();
            for (const bot of list) {
                const { row, actions } = this.row(bot.username, bot.disabled ? '已停用' : '启用中');
                this.button(actions, '资料', async () => { const username = prompt('Bot 名称', bot.username); if (!username) return; const about = prompt('简介', bot.about || ''); if (about === null) return; await this.request('/api/bots/' + bot.id, { method: 'PUT', body: JSON.stringify({ username, about }) }); this.loadBots(); });
                this.button(actions, bot.disabled ? '启用' : '停用', async () => { await this.request('/api/bots/' + bot.id, { method: 'PUT', body: JSON.stringify({ disabled: !bot.disabled }) }); this.loadBots(); });
                this.button(actions, '重置令牌', async () => { if (confirm('旧令牌会立即失效。继续？')) this.showBotToken((await this.request('/api/bots/' + bot.id + '/token', { method: 'POST' })).token); });
                const avatar = document.createElement('input'); avatar.type = 'file'; avatar.accept = 'image/png,image/jpeg'; avatar.setAttribute('aria-label', bot.username + ' 头像');
                avatar.onchange = async () => { const file = avatar.files[0]; if (!file) return; try { const response = await fetch('/api/bots/' + bot.id + '/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(this.token() ? { Authorization: 'Bearer ' + this.token() } : {}) }, body: file }); const data = await response.json(); if (!response.ok) throw new Error(data.error); this.loadBots(); } catch(error) { alert(error.message); } }; actions.append(avatar);
                this.button(actions, '删除', async () => { if (confirm('删除此 Bot？')) { await this.request('/api/bots/' + bot.id, { method: 'DELETE' }); this.loadBots(); document.getElementById('bot-token').hidden = true; } }, 'danger'); container.append(row);
            }
        } catch(error) { document.getElementById('admin-bots-list').textContent = error.message; }
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const me = await adminAPI.request('/api/me');
        if (!['admin', 'superadmin'].includes(me.role)) return location.replace('/chat');
        window.chatApp = { currentUser: me.username, userRole: me.role, escapeHtml: value => {
            const span = document.createElement('span'); span.textContent = String(value); return span.innerHTML;
        } };
        adminAPI.refreshAll();
        setInterval(async () => { try { const current = await adminAPI.request('/api/me');
            if (!['admin', 'superadmin'].includes(current.role)) location.replace('/chat');
            window.chatApp.currentUser = current.username; window.chatApp.userRole = current.role;
        } catch { location.replace('/'); } }, 10000);
    } catch { location.replace('/'); }
});
