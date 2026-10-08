const assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path'), dgram = require('node:dgram');
const { once } = require('node:events'), { test } = require('node:test');
const { fixture, receive } = require('./fixture.cjs');
const password = 'social-test-password';
const seed = () => ({
  'users.json': { users: ['admin', 'alice', 'bob', 'charlie'].map((username, i) => ({
    username, role: i === 0 ? 'admin' : 'user', salt: username,
    passwordHash: crypto.scryptSync(password, username, 64).toString('hex'), registeredIp: '', createdAt: i + 1
  })), tokens: {} },
  'rooms.json': { rooms: [{ id: 'legacy', name: '旧公开群', isPublic: true, members: [], createdBy: 'admin', created: 1 }] }
});

test('social migration, friendships, private conversations and resource authorization', { timeout: 30000 }, async t => {
  const f = await fixture(seed()); t.after(f.cleanup);
  const { api } = f;
  const login = async username => { const auth = await api('/api/login', null, { method: 'POST', body: { username, password } }); return { ...auth, ...(await api('/api/me', auth.token)), token: auth.token }; };
  const admin = await login('admin'), alice = await login('alice'), bob = await login('bob'), charlie = await login('charlie');
  let a = await f.connect(alice.token), b = await f.connect(bob.token), c = await f.connect(charlie.token), dm, file;
  const rejected = async (socket, event, data) => { const error = receive(socket, 'error'); socket.emit(event, data); assert.match(await error, /无权|好友|未获邀请/); };
  await t.test('visitors cannot retrieve chat source; regular users cannot retrieve admin source, including encoded paths', async () => {
    const page = await api('/', null); assert.ok(!page.includes('messages-container')); assert.ok(!page.includes('adminAPI'));
    for (const resource of ['/chat', '/client/chat.html', '/client/chat.js', '/client/styles.css', '/client/composer.js', '/client/markdown.js', '/assets/katex/katex.min.js']) {
      await api(resource, null, { status: 401 }); await api(resource, alice.token);
    }
    for (const resource of ['/admin', '/client/admin.html', '/client/admin.js', '/client/admin.css', '/client/%61dmin.js', '/client/admin%2ehtml']) {
      await api(resource, null, { status: 401 }); await api(resource, alice.token, { status: 403 }); await api(resource, admin.token);
    }
    await api('/client/ADMIN.JS', alice.token, { status: 403 });
    await api('/client/admin.js%3a%3a$DATA', alice.token, { status: 403 });
    await api('/client/%2561dmin.js', alice.token, { status: 400 });
    await api('/client/vendor%2f..%2fadmin.js', alice.token, { status: 400 });
    const chat = await api('/chat', alice.token); assert.ok(!chat.includes('adminAPI')); assert.ok(!chat.includes('admin-accounts-list'));
    const source = await api('/client/chat.js', alice.token); assert.ok(!source.includes('resetPassword')); assert.ok(!source.includes('/api/config'));
    const header = await f.request('/client/admin.js', admin.token); assert.equal(header.headers.get('cache-control'), 'no-store');
  });
  await t.test('legacy public access is preserved and new accounts join default only', async () => {
    assert.ok((await api('/api/rooms', alice.token)).some(room => room.id === 'legacy'));
    assert.equal(typeof alice.id, 'string');
    assert.ok(fs.existsSync(path.join(f.dir, 'users.json.pre-social.bak')));
    assert.ok(fs.existsSync(path.join(f.dir, 'rooms.json.pre-social.bak')));
    const newcomer = await api('/api/register', null, { method: 'POST', body: { username: 'newcomer', password } });
    assert.deepEqual((await api('/api/rooms', newcomer.token)).map(room => room.id), ['default']);
    await api('/api/rooms/legacy/messages', newcomer.token, { status: 403 });
    await api('/api/rooms/default/leave', newcomer.token, { method: 'POST', status: 400 });
  });
  await t.test('requests enforce recipient decisions, deduplication, rejection and withdrawal', async () => {
    await api('/api/direct-chats', alice.token, { method: 'POST', body: { userId: bob.id }, status: 403 });
    const request = (await api('/api/friend-requests', alice.token, { method: 'POST', body: { userId: charlie.id } })).request;
    await api('/api/friend-requests', charlie.token, { method: 'POST', body: { userId: alice.id }, status: 409 });
    await api('/api/friend-requests/' + request.id, alice.token, { method: 'PUT', body: { action: 'accept' }, status: 403 });
    await api('/api/friend-requests/' + request.id, bob.token, { method: 'PUT', body: { action: 'reject' }, status: 403 });
    await api('/api/friend-requests/' + request.id, charlie.token, { method: 'PUT', body: { action: 'reject' } });
    await api('/api/friend-requests/' + request.id, charlie.token, { method: 'PUT', body: { action: 'accept' }, status: 409 });
    const outgoing = (await api('/api/friend-requests', alice.token, { method: 'POST', body: { userId: charlie.id } })).request;
    await api('/api/friend-requests/' + outgoing.id, alice.token, { method: 'PUT', body: { action: 'withdraw' } });
    assert.equal((await api('/api/social', charlie.token)).requests.length, 0);
    const accepted = (await api('/api/friend-requests', alice.token, { method: 'POST', body: { userId: bob.id } })).request;
    dm = (await api('/api/friend-requests/' + accepted.id, bob.token, { method: 'PUT', body: { action: 'accept' } })).room;
    assert.equal(dm.kind, 'direct'); assert.equal((await api('/api/social', alice.token)).friends[0].id, bob.id);
    assert.equal((await api('/api/direct-chats', alice.token, { method: 'POST', body: { userId: bob.id } })).room.id, dm.id);
  });
  await t.test('only the two participants can read, send, list files or fetch private files', async () => {
    const received = receive(b, 'message', message => message.room === dm.id);
    a.emit('send_message', { roomId: dm.id, content: '**private** $x^2$' }); assert.equal((await received).userId, alice.id);
    for (const route of ['/messages', '/members']) await api('/api/rooms/' + dm.id + route, charlie.token, { status: 403 });
    await api('/api/rooms/' + dm.id + '/messages', admin.token, { status: 403 });
    await rejected(c, 'send_message', { roomId: dm.id, content: 'bypass' });
    await rejected(c, 'join_room', { roomId: dm.id });
    const upload = { method: 'POST', body: 'private attachment', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'private.txt', 'x-mime': 'text/plain' } };
    await api('/api/upload?room=' + dm.id, charlie.token, { ...upload, status: 403 });
    file = (await api('/api/upload?room=' + dm.id, alice.token, upload)).file;
    const delivered = receive(b, 'message', message => message.storedName === file.storedName);
    a.emit('send_file', { roomId: dm.id, storedName: file.storedName }); await delivered;
    await api(file.url, charlie.token, { status: 403 }); assert.equal(await api(file.url, bob.token), 'private attachment');
    await api('/api/files?room=' + dm.id, charlie.token, { status: 403 });
    assert.deepEqual((await api('/api/rooms/' + dm.id + '/members', alice.token)).map(member => member.id).sort(), [alice.id, bob.id].sort());
  });
  await t.test('rename and restart keep IDs, friends, conversations, histories and attachments', async () => {
    await api('/api/users/bob', admin.token, { method: 'PUT', body: { newUsername: 'renamed-bob' } });
    assert.equal((await api('/api/me', bob.token)).id, bob.id);
    assert.equal((await api('/api/rooms', alice.token)).find(room => room.id === dm.id).name, 'renamed-bob');
    const received = receive(b, 'message', message => message.content === 'history-59');
    for (let i = 0; i < 60; i++) a.emit('send_message', { roomId: dm.id, content: 'history-' + i }); await received;
    await f.stop(); await f.start(); a = await f.connect(alice.token); b = await f.connect(bob.token); c = await f.connect(charlie.token);
    assert.equal((await api('/api/social', alice.token)).friends[0].id, bob.id);
    assert.equal((await api('/api/rooms', bob.token)).find(room => room.id === dm.id).name, 'alice');
    const history = await api('/api/rooms/' + dm.id + '/messages', bob.token); assert.equal(history.length, 62);
    assert.equal(history[0].content, '**private** $x^2$');
    const earlier = await api('/api/rooms/' + dm.id + '/messages?beforeId=' + history[20].id, bob.token); assert.equal(earlier.length, 20);
    assert.equal(await api(file.url, bob.token), 'private attachment');
  });
  await t.test('deleting a friend stops new text, typing and uploads but preserves existing history', async () => {
    await api('/api/friends/' + bob.id, alice.token, { method: 'DELETE' });
    await rejected(a, 'send_message', { roomId: dm.id, content: 'after removal' });
    await rejected(a, 'send_file', { roomId: dm.id, storedName: file.storedName });
    await api('/api/upload?room=' + dm.id, alice.token, { method: 'POST', body: 'blocked', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'blocked.txt' }, status: 403 });
    assert.equal((await api('/api/rooms', bob.token)).find(room => room.id === dm.id).canSend, false);
    assert.equal((await api('/api/rooms/' + dm.id + '/messages', bob.token)).length, 62);
  });
  await t.test('individual group removal immediately revokes files, histories, messages and notifications', async () => {
    await api('/api/rooms', admin.token, { method: 'POST', body: { roomId: 'new-group', isPublic: true } });
    await api('/api/rooms/new-group/join', alice.token, { method: 'POST' });
    const groupFile = (await api('/api/upload?room=new-group', alice.token, { method: 'POST', body: 'group file', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'group.txt' } })).file;
    const joined = receive(a, 'room_joined', room => room.roomId === 'new-group'); a.emit('join_room', { roomId: 'new-group' }); await joined;
    const kicked = receive(a, 'kicked_from_room'); await api('/api/rooms/new-group/members/' + alice.id, admin.token, { method: 'DELETE' }); await kicked;
    await api('/api/rooms/new-group/messages', alice.token, { status: 403 }); await api(groupFile.url, alice.token, { status: 403 });
    await rejected(a, 'send_message', { roomId: 'new-group', content: 'removed' });
    await api('/api/users/charlie/role', admin.token, { method: 'PUT', body: { role: 'admin' } });
    await api('/client/admin.js', charlie.token);
    await api('/api/users/charlie/role', admin.token, { method: 'PUT', body: { role: 'user' } });
    await api('/client/admin.js', charlie.token, { status: 403 });
  });
});


test('Jiyu automatically uses fixed account IPs and drops messages in cooldown while chat delivery continues', { timeout: 15000 }, async t => {
  const f = await fixture(seed()); t.after(f.cleanup);
  const udp = dgram.createSocket('udp4'); udp.bind(0, '0.0.0.0'); await once(udp, 'listening'); t.after(() => udp.close());
  const packets = []; udp.on('message', packet => packets.push(packet));
  const auth = {};
  for (const name of ['admin', 'alice', 'bob', 'charlie']) {
    const user = await f.api('/api/login', null, { method: 'POST', body: { username: name, password } });
    auth[name] = { ...user, ...(await f.api('/api/me', user.token)), token: user.token };
  }
  const { admin, alice, bob, charlie } = auth;
  assert.equal((await f.api('/api/config', admin.token)).jiyuEnabled, false);
  const devices = await f.api('/api/jiyu/devices', admin.token); assert.equal(devices.find(device => device.userId === bob.id).ip, bob.boundIp);
  await f.api('/api/jiyu/devices/' + bob.id, admin.token, { method: 'PUT', body: { ips: ['127.0.0.9'] }, status: 404 });
  await f.api('/api/config', admin.token, { method: 'PUT', body: { jiyuPort: udp.address().port, jiyuEnabled: true } });
  const a = await f.connect(alice.token), b = await f.connect(bob.token), c = await f.connect(charlie.token), ad = await f.connect(admin.token);
  const pause = () => new Promise(resolve => setTimeout(resolve, 90));
  for (const socket of [b,c,ad]) socket.emit('client_state', { isViewing: true }); await pause();
  async function send(content) { const delivered = receive(b, 'message', msg => msg.content === content); a.emit('send_message', { content, roomId: 'default' }); await delivered; await pause(); }
  await send('active readers'); assert.equal(packets.length, 0);
  b.emit('client_state', { isViewing: false }); await pause(); await send('private details');
  assert.equal(packets.length, 1); assert.equal(packets[0].subarray(56).toString('utf16le').replace(/\0.*$/s, ''), 'from alice: new message');
  await send('same device and room must be ignored'); assert.equal(packets.length, 1);
  const file = (await f.api('/api/upload?room=default', alice.token, { method: 'POST', body: 'payload', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'secret-name', 'x-mime': 'image/png' } })).file;
  const delivered = receive(b, 'message', msg => msg.storedName === file.storedName); a.emit('send_file', { storedName: file.storedName }); await delivered; await pause(); assert.equal(packets.length, 1);
  const skipped = await f.api('/api/jiyu/test', admin.token, { method: 'POST', body: { userId: bob.id } }); assert.equal(skipped.sent, 0); assert.equal(skipped.skipped, 1); assert.match(skipped.message, /冷却/);
  c.disconnect(); await pause(); await send('closed browser on a different device'); assert.equal(packets.length, 2);
  await f.api('/api/rooms', admin.token, { method: 'POST', body: { roomId: 'unjoined', isPublic: true } });
  ad.emit('send_message', { roomId: 'unjoined', content: 'must not notify nonmembers' }); await pause(); assert.equal(packets.length, 2);
  await f.api('/api/jiyu/test', admin.token, { method: 'POST', body: { ip: '192.168.1.2' }, status: 400 });
  const result = await f.api('/api/jiyu/test', admin.token, { method: 'POST', body: { userId: alice.id } }); assert.equal(result.sent, 1); assert.match(result.message, /需在目标设备确认/); await pause();
  assert.equal(packets.at(-1).subarray(56).toString('utf16le').replace(/\0.*$/s, ''), 'from admin: new message');
});
