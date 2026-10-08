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
                    const rooms = await this.request('/api/rooms?manage=1');
                    const el = document.getElementById('admin-rooms-list');
                    el.replaceChildren();
                    for (const room of rooms) {
                        const members = `成员：${room.members.join('、') || '无'}`;
                        const { row, actions } = this.row(room.name, `ID: ${room.id} | ${room.isPublic ? '公开' : '私有'} | ${room.userCount}人在线 | ${members}`);
                        if (room.id !== 'default') {
                            this.button(actions, '邀请用户', () => this.inviteUser(room.id, room.name));
                            this.button(actions, '移除受邀成员', () => this.kickRoom(room.id, room.name));
                        }
                        if (room.id !== 'default') this.button(actions, '删除', () => this.deleteRoom(room.id, room.name, room.userCount), 'danger');
                        el.appendChild(row);
                    }
                    if (!rooms.length) el.textContent = '暂无可管理的房间';
                } catch (e) { document.getElementById('admin-rooms-list').textContent = '❌ ' + e.message; }
            },
            async inviteUser(roomId, roomName) {
                const username = prompt(`邀请已有账号加入群聊「${roomName}」，请输入用户名：`);
                if (!username || !username.trim()) return;
                try {
                    await this.request(`/api/rooms/${encodeURIComponent(roomId)}/invitations`, { method: 'POST', body: JSON.stringify({ username: username.trim() }) });
                    this.loadRooms();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async createRoom() {
                const roomId = document.getElementById('admin-room-id').value.trim();
                const roomName = document.getElementById('admin-room-name').value.trim();
                try {
                    const r = await this.request('/api/rooms', { method: 'POST', body: JSON.stringify({ roomId, roomName, isPublic: document.getElementById('admin-room-visibility').value === 'public' }) });
                    alert('✅ ' + r.message);
                    this.loadRooms();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async deleteRoom(roomId, roomName, userCount) {
                let force = false;
                if (userCount > 0) {
                    force = confirm(`房间 "${roomName}" 中有 ${userCount} 个用户，将强制删除并踢出他们，确定？`);
                    if (!force) return;
                } else if (!confirm(`确定删除房间 "${roomName}" ？`)) return;
                try {
                    const r = await this.request(`/api/rooms/${encodeURIComponent(roomId)}${force ? '?force=true' : ''}`, { method: 'DELETE' });
                    alert('✅ ' + r.message);
                    this.loadRooms();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async kickRoom(roomId, roomName) {
                if (!confirm(`确定移除房间 "${roomName}" 中的所有受邀成员？房间创建者会保留。`)) return;
                try {
                    const r = await this.request(`/api/rooms/${encodeURIComponent(roomId)}/kick-users`, { method: 'POST', body: '{}' });
                    alert('✅ ' + r.message);
                    this.loadRooms();
                    this.loadOnline();
                } catch (e) { alert('❌ ' + e.message); }
            },
            async loadAccounts() {
                try {
                    const accounts = await this.request('/api/accounts');
                    const el = document.getElementById('admin-accounts-list');
                    el.replaceChildren();
                    const me = window.chatApp;
                    for (const account of accounts) {
                        const roleName = { superadmin: '超级管理员', admin: '管理员', user: '普通用户' }[account.role];
                        const { row, actions } = this.row(account.username, `${roleName} | 注册IP: ${account.registeredIp || '-'}`);
                        const editable = me.userRole === 'superadmin' || account.role === 'user' || account.username === me.currentUser;
                        if (editable) {
                            this.button(actions, '改名', () => this.renameUser(account.username));
                            this.button(actions, '重置密码', () => this.resetPassword(account.username));
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
                    const [accounts, devices] = await Promise.all([this.request('/api/accounts'), this.request('/api/jiyu/devices')]);
                    const container = document.getElementById('jiyu-devices'); container.replaceChildren();
                    for (const account of accounts) {
                        const ips = devices.filter(d => d.userId === account.id).map(d => d.ip);
                        const { row, actions } = this.row(account.username, ips.join('、') || '未绑定设备');
                        this.button(actions, '绑定设备', async () => {
                            const value = prompt('输入此账号使用的已授权内网设备 IPv4 地址，多个用逗号分隔；留空解除绑定', ips.join(','));
                            if (value === null) return;
                            try { await this.request('/api/jiyu/devices/' + encodeURIComponent(account.id), {
                                method: 'PUT', body: JSON.stringify({ ips: value.split(',').map(v => v.trim()).filter(Boolean) })
                            }); this.loadDevices(); } catch(e) { alert(e.message); }
                        });
                        for (const ip of ips) this.button(actions, '测试 ' + ip, async () => {
                            try { const result = await this.request('/api/jiyu/test', { method: 'POST', body: JSON.stringify({ ip }) }); alert(result.message); }
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
