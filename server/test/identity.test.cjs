const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fixture, receive } = require('./fixture.cjs');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');
const password = 'ip-policy-password';
test('one account per actual device IP, including initial superadmin login, tokens, files and sockets', { timeout: 15000 }, async t => {
  const users = ['admin', 'alice', 'bob'].map((username, index) => ({ username, role: index ? 'user' : 'admin',
    salt: username, passwordHash: crypto.scryptSync(password, username, 64).toString('hex'),
    registeredIp: index === 0 ? '127.0.0.90' : index === 1 ? '127.0.0.3' : '', createdAt: index + 1 }));
  const f = await fixture({ 'users.json': { users, tokens: { 'old-admin-token': { username: 'admin', expiresAt: Date.now() + 60000 } } } }); t.after(f.cleanup);
  const login = (username, sourceIp, status = 200, secret = password) => f.api('/api/login', null, { method: 'POST', sourceIp, status, body: { username, password: secret } });
  const readUsers = () => JSON.parse(fs.readFileSync(path.join(f.dir, 'users.json'), 'utf8')).users;
  await f.api('/api/me', 'old-admin-token', { sourceIp: '127.0.0.2', status: 403 });
  assert.equal(readUsers()[0].boundIp, '');
  await login('admin', '127.0.0.2', 401, 'wrong-password'); assert.equal(readUsers()[0].boundIp, '');
  const admin = await login('admin', '127.0.0.2'); assert.equal(readUsers()[0].boundIp, '127.0.0.2');
  const alice = await login('alice', '127.0.0.3'); assert.equal(readUsers()[1].boundIp, '127.0.0.3');
  await login('admin', '127.0.0.90', 403); await login('alice', '127.0.0.2', 403);
  await login('bob', '127.0.0.2', 403); assert.equal(readUsers()[2].boundIp, '');
  await login('bob', '127.0.0.4');
  await f.api('/api/register', null, { method: 'POST', sourceIp: '127.0.0.2', body: { username: 'duplicate', password }, status: 403 });
  const account = await f.api('/api/me', alice.token); assert.equal(account.boundIp, '127.0.0.3');
  const file = (await f.api('/api/upload?room=default', alice.token, { method: 'POST', body: 'device file', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'device.txt' } })).file;
  for (const route of ['/api/me', '/client/chat.js', '/api/rooms', file.url]) await f.api(route, alice.token, { sourceIp: '127.0.0.9', status: 403,
    headers: { 'x-forwarded-for': '127.0.0.3', 'cf-connecting-ip': '127.0.0.3' } });
  await f.api('/api/me', null, { sourceIp: '127.0.0.9', status: 403, headers: { cookie: 'lantalk_session=' + alice.token } });
  const socket = io(f.base, { transports: ['websocket'], query: { sourceIp: '127.0.0.9' }, autoConnect: false, reconnection: false }); t.after(() => socket.disconnect());
  const connected = receive(socket, 'connect'); socket.connect(); await connected;
  const denied = receive(socket, 'error'); socket.emit('join', { token: alice.token }); assert.match(await denied, /关联.*IP/);
  const deniedSend = receive(socket, 'error'); socket.emit('send_message', { content: 'stolen token' }); assert.match(await deniedSend, /请先加入/);
  await f.api('/api/users/alice', admin.token, { method: 'PUT', body: { newUsername: 'renamed-alice' } });
  assert.equal((await f.api('/api/me', alice.token)).boundIp, '127.0.0.3');
  await f.stop(); await f.start();
  await login('admin', '127.0.0.2'); await login('renamed-alice', '127.0.0.3'); await login('admin', '127.0.0.9', 403);
  await f.api('/api/users/renamed-alice', admin.token, { method: 'DELETE' });
  const replacement = await f.api('/api/register', null, { method: 'POST', sourceIp: '127.0.0.3', body: { username: 'replacement', password } });
  assert.equal((await f.api('/api/me', replacement.token)).boundIp, '127.0.0.3');
  assert.equal(new Set(readUsers().map(user => user.boundIp)).size, readUsers().length);
});
