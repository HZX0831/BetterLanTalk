const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '../..');
const { request, sourceFor } = require('./network.cjs');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');

function receive(socket, name, matches = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, listener); reject(new Error('Timeout: ' + name)); }, 4000);
    function listener(data) {
      if (!matches(data)) return;
      clearTimeout(timer); socket.off(name, listener); resolve(data);
    }
    socket.on(name, listener);
  });
}

test('persistent room membership and live administrator permissions', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantalk-rooms-'));
  const dir = path.join(root, 'server'); fs.mkdirSync(dir);
  for (const file of ['server.js', 'markdown.js', 'social.js', 'jiyu.js']) fs.copyFileSync(path.join(repo, 'server', file), path.join(dir, file));
  fs.symlinkSync(path.join(repo, 'server/node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(repo, 'client'), path.join(root, 'client'), 'dir');
  // Existing installations must retain passwords while upgrading the initial admin.
  const password = 'test-password';
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: ['admin', 'manager', 'outsider'].map((username, i) => ({
    username, role: i === 0 ? 'admin' : 'user', salt: username,
    passwordHash: crypto.scryptSync(password, username, 64).toString('hex'), registeredIp: '', createdAt: i + 1
  })), tokens: {} }));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const base = 'http://127.0.0.1:' + port;
  let child;
  const sockets = [];
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port), LANTALK_OPEN_BROWSER: '0' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, 'server running');
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Server not ready');
  }
  async function stop() {
    for (const socket of sockets.splice(0)) socket.disconnect();
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill('SIGINT'); await stopped;
    }
  }
  async function api(route, token, { method = 'GET', body, status = 200, headers = {} } = {}) {
    const response = await request(base + route, {
      localAddress: sourceFor(dir, token, typeof body === 'object' ? body?.username : undefined),
      method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    assert.equal(response.status, status, route + ' ' + method);
    return response.json();
  }
  async function connect(token) {
    const socket = io(base, { transports: ['websocket'], query: { sourceIp: sourceFor(dir, token) }, autoConnect: false, reconnection: false }); sockets.push(socket);
    const connected = receive(socket, 'connect'); socket.connect(); await connected;
    const joined = receive(socket, 'room_joined'); socket.emit('join', { token }); await joined;
    return socket;
  }
  async function rejected(socket, event, data, expected) {
    const error = receive(socket, 'error'); socket.emit(event, data); assert.match(await error, expected);
  }
  let admin, manager, outsider, newcomer, a, m, o, uploaded;
  try {
    await start();
    await t.test('migration, ordinary-user API and WebSocket restrictions', async () => {
      admin = await api('/api/login', null, { method: 'POST', body: { username: 'admin', password } });
      manager = await api('/api/login', null, { method: 'POST', body: { username: 'manager', password } });
      outsider = await api('/api/login', null, { method: 'POST', body: { username: 'outsider', password } });
      assert.equal(admin.role, 'superadmin');
      a = await connect(admin.token); m = await connect(manager.token); o = await connect(outsider.token);
      await api('/api/rooms', null, { status: 401 });
      await api('/api/rooms', manager.token, { method: 'POST', body: { roomId: 'forbidden' }, status: 403 });
      await rejected(m, 'create_room', { roomId: 'forbidden' }, /管理员/);
      await rejected(a, 'create_room', null, /参数无效/);
      await rejected(o, 'join', { token: outsider.token, roomId: 'unknown' }, /不存在/);
      await rejected(m, 'delete_room', { roomId: 'default' }, /管理权限/);
      await rejected(m, 'join_room', { roomId: 'unknown' }, /不存在/);
      assert.equal((await api('/api/rooms', manager.token)).length, 1);
    });
    await t.test('only the superadmin assigns roles; existing sessions update immediately', async () => {
      await api('/api/users/manager/role', manager.token, { method: 'PUT', body: { role: 'admin' }, status: 403 });
      const changed = receive(m, 'account_changed');
      await api('/api/users/manager/role', admin.token, { method: 'PUT', body: { role: 'admin' } });
      assert.equal((await changed).role, 'admin');
      assert.equal((await api('/api/me', manager.token)).role, 'admin');
      await api('/api/users/admin', manager.token, { method: 'PUT', body: { newPassword: 'changed-password' }, status: 403 });
      await api('/api/users/admin', manager.token, { method: 'DELETE', status: 403 });
      await api('/api/users/admin/role', admin.token, { method: 'PUT', body: { role: 'user' }, status: 403 });
      const created = receive(m, 'room_created');
      m.emit('create_room', { roomId: 'private-team', roomName: '私有项目', isPublic: false }); await created;
      const privateRoom = (await api('/api/rooms', manager.token)).find(r => r.id === 'private-team');
      assert.equal(privateRoom.isPublic, false); assert.deepEqual(privateRoom.members, ['manager']);
      await api('/api/rooms', manager.token, { method: 'POST', body: { roomId: 'bad', isPublic: 'false' }, status: 400 });
    });
    await t.test('private rooms conceal history, membership, files and live events until invited', async () => {
      assert.ok(!(await api('/api/rooms', outsider.token)).some(r => r.id === 'private-team'));
      await api('/api/rooms?manage=1', outsider.token, { status: 403 });
      await rejected(o, 'join_room', { roomId: 'private-team' }, /未获邀请/);
      await rejected(o, 'send_message', { roomId: 'private-team', content: 'attack' }, /无权/);
      await api('/api/files?room=private-team', outsider.token, { status: 403 });
      const uploadOptions = { method: 'POST', body: 'private file', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'private.txt', 'x-mime': 'text/plain' } };
      await api('/api/upload?room=private-team', outsider.token, { ...uploadOptions, status: 403 });
      uploaded = await api('/api/upload?room=private-team', manager.token, uploadOptions);
      await api(uploaded.file.url, null, { status: 401 });
      await api(uploaded.file.url, outsider.token, { status: 403 });
      // Even the superadmin can manage definitions but needs an invitation to read private content.
      await api('/api/files?room=private-team', admin.token, { status: 403 });
      assert.ok((await api('/api/rooms?manage=1', admin.token)).some(r => r.id === 'private-team'));
      const secretEvents = []; o.on('message', msg => secretEvents.push(msg));
      m.on('user_typing', data => secretEvents.push(data));
      o.emit('typing', { roomId: 'private-team', isTyping: true });
      const message = receive(m, 'message', msg => msg.content === 'secret');
      m.emit('send_message', { roomId: 'private-team', content: 'secret' }); await message;
      assert.equal((await api('/api/rooms?manage=1', admin.token)).find(room => room.id === 'private-team').lastMessage, null, 'management metadata must not reveal private message previews');
      await new Promise(r => setTimeout(r, 80));
      assert.ok(!secretEvents.some(msg => msg.room === 'private-team'));
      // A room ID equal to a Socket.IO connection ID must not bypass membership.
      await api('/api/rooms', admin.token, { method: 'POST', body: { roomId: o.id, isPublic: false } });
      const collisionMessage = receive(a, 'message', msg => msg.room === o.id);
      a.emit('send_message', { roomId: o.id, content: 'connection-room isolation' }); await collisionMessage;
      await new Promise(r => setTimeout(r, 80));
      assert.ok(!secretEvents.some(msg => msg.content === 'connection-room isolation'));
      await api('/api/rooms/private-team/invitations', manager.token, { method: 'POST', body: { username: 'missing' }, status: 404 });
      const visible = receive(o, 'room_list', list => list.some(r => r.id === 'private-team'));
      await api('/api/rooms/private-team/invitations', manager.token, { method: 'POST', body: { username: 'outsider' } }); await visible;
      const history = receive(o, 'message_history', list => list.some(msg => msg.content === 'secret'));
      o.emit('join_room', { roomId: 'private-team' }); await history;
      const download = await request(base + uploaded.file.url, { localAddress: sourceFor(dir, outsider.token), headers: { authorization: 'Bearer ' + outsider.token } });
      assert.equal(await download.text(), 'private file');
      await rejected(o, 'send_file', { roomId: 'default', storedName: uploaded.file.storedName }, /不能转发/);
      await rejected(o, 'send_file', { roomId: 'private-team', storedName: uploaded.file.storedName }, /不能转发/);
    });
    await t.test('public groups require joining; new accounts only join default', async () => {
      await api('/api/rooms', admin.token, { method: 'POST', body: { roomId: 'public-team', roomName: '公开项目', isPublic: true } });
      assert.ok(!(await api('/api/rooms', outsider.token)).some(r => r.id === 'public-team'));
      await rejected(o, 'join_room', { roomId: 'public-team' }, /未获邀请/);
      await api('/api/rooms/public-team/join', outsider.token, { method: 'POST' });
      const received = receive(o, 'message', msg => msg.room === 'public-team');
      a.emit('send_message', { roomId: 'public-team', content: 'public announcement' }); await received;
      newcomer = await api('/api/register', null, { method: 'POST', body: { username: 'newcomer', password } });
      assert.deepEqual((await api('/api/rooms', newcomer.token)).map(r => r.id), ['default']);
      const n = await connect(newcomer.token);
      await api('/api/rooms/public-team/join', newcomer.token, { method: 'POST' });
      const delivered = receive(n, 'message', msg => msg.room === 'public-team');
      a.emit('send_message', { roomId: 'public-team', content: 'new account' }); await delivered;
      await api('/api/rooms/public-team?force=true', manager.token, { method: 'DELETE', status: 403 });
    });
    await t.test('demotion revokes room management over old tokens and sockets', async () => {
      const changed = receive(m, 'account_changed');
      await api('/api/users/manager/role', admin.token, { method: 'PUT', body: { role: 'user' } }); assert.equal((await changed).role, 'user');
      await api('/api/rooms', manager.token, { method: 'POST', body: { roomId: 'stale-role' }, status: 403 });
      await api('/api/rooms/private-team/invitations', manager.token, { method: 'POST', body: { username: 'newcomer' }, status: 403 });
      await rejected(m, 'create_room', { roomId: 'stale-role' }, /管理员/);
      await rejected(m, 'delete_room', { roomId: 'private-team' }, /管理权限/);
      await api('/api/users/manager/role', admin.token, { method: 'PUT', body: { role: 'admin' } });
      await api('/api/users/outsider', admin.token, { method: 'PUT', body: { newUsername: 'renamed' } });
      assert.equal((await api('/api/me', outsider.token)).username, 'renamed');
    });
    await t.test('room definitions, invitations, renames and roles survive restart', async () => {
      await stop();
      const storedUsers = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'));
      storedUsers.tokens['short-session'] = { username: 'renamed', expiresAt: Date.now() + 2500 };
      fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(storedUsers));
      await start();
      const shortSession = await connect('short-session');
      const expired = receive(shortSession, 'disconnect');
      const listed = await api('/api/rooms', outsider.token);
      assert.ok(listed.some(r => r.id === 'private-team'));
      assert.ok(listed.some(r => r.id === 'public-team'));
      assert.equal((await api('/api/me', manager.token)).role, 'admin');
      const info = (await api('/api/rooms?manage=1', manager.token)).find(r => r.id === 'private-team');
      assert.deepEqual(info.members, ['manager', 'renamed']);
      assert.equal((await api('/api/files?room=private-team', outsider.token))[0].storedName, uploaded.file.storedName);
      o = await connect(outsider.token);
      const joined = receive(o, 'room_joined', room => room.roomId === 'private-team');
      o.emit('join_room', { roomId: 'private-team' }); await joined;
      const kicked = receive(o, 'kicked_from_room');
      const removed = receive(o, 'room_list', list => !list.some(r => r.id === 'private-team'));
      await api('/api/rooms/private-team/kick-users', manager.token, { method: 'POST', body: {} }); await kicked; await removed;
      await api(uploaded.file.url, outsider.token, { status: 403 });
      await rejected(o, 'join_room', { roomId: 'private-team' }, /未获邀请/);
      await api('/api/rooms/default?force=true', admin.token, { method: 'DELETE', status: 400 });
      await api('/api/rooms/private-team?force=true', admin.token, { method: 'DELETE' });
      assert.ok(!(await api('/api/rooms?manage=1', admin.token)).some(r => r.id === 'private-team'));
      await expired;
      await api('/api/me', 'short-session', { status: 401 });
      const disconnected = receive(o, 'disconnect');
      await api('/api/logout', outsider.token, { method: 'POST' }); await disconnected;
      await api('/api/me', outsider.token, { status: 401 });
      await api('/api/rooms', newcomer.token, { status: 200 });
      await api('/api/rooms/private-team', newcomer.token, { method: 'DELETE', status: 403 });
    });
  } finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
});
