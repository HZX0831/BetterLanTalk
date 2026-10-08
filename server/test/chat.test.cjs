const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '../..');

async function readiness(base) {
  const health = await fetch(base + '/api/health', { signal: AbortSignal.timeout(3000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const status = await fetch(base + '/api/status', { signal: AbortSignal.timeout(3000) });
  assert.equal(status.status, 200);
  const info = await status.json();
  assert.equal(info.name, '内网聊天室服务器');
  assert.equal(info.status, 'running');
  assert.equal(info.version, '1.0.1');
  for (const route of ['/', '/client/index.html', '/socket.io/socket.io.js', '/assets/katex/katex.min.js', '/assets/prism/prism.js', '/assets/purify.js', '/client/vendor/luogu-markdown-editor/luogu-parser.js']) {
    const r = await fetch(base + route, { signal: AbortSignal.timeout(3000) });
    assert.equal(r.status, 200, route);
    const content = await r.text();
    assert.ok(content.length > 1000, route);
    if (route === '/' || route === '/client/index.html') assert.ok(content.includes('<title>BetterLanTalk 内网聊天室</title>'), route);
  }
}

function event(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timeout: ' + name)); }, 5000);
    const receive = data => { if (predicate(data)) { cleanup(); resolve(data); } };
    const fail = () => { cleanup(); reject(new Error('Socket error while waiting for ' + name)); };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(name, receive);
      socket.off('connect_error', fail);
      socket.off('error', fail);
    };
    socket.on(name, receive);
    socket.on('connect_error', fail);
    socket.on('error', fail);
  });
}

async function smoke() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'betterlantalk-smoke-'));
  const workdir = path.join(root, 'server');
  fs.mkdirSync(workdir);
  fs.copyFileSync(path.join(repo, 'server/server.js'), path.join(workdir, 'server.js'));
  fs.copyFileSync(path.join(repo, 'server/markdown.js'), path.join(workdir, 'markdown.js'));
  fs.symlinkSync(path.join(repo, 'server/node_modules'), path.join(workdir, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(repo, 'client'), path.join(root, 'client'), 'dir');
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: workdir,
    env: { ...process.env, PORT: String(port), LANTALK_OPEN_BROWSER: '0', LANTALK_NO_BROWSER: '1' },
    stdio: 'ignore'
  });
  let childError;
  child.on('error', e => { childError = e; });
  const sockets = [];
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (childError) throw childError;
      if (child.exitCode !== null) throw new Error('Smoke server exited: ' + child.exitCode);
      try { await readiness(base); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Server startup');
    console.log('PASS: startup, health, HTML and locally served Socket.IO');
    async function api(route, { method = 'GET', token, body, status = 200, headers = {} } = {}) {
      const r = await fetch(base + route, {
        method,
        headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body && (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: AbortSignal.timeout(5000)
      });
      assert.equal(r.status, status, route);
      return r.json();
    }
    await api('/api/accounts', { status: 401 });
    const user = await api('/api/register', { method: 'POST', body: { username: 'onboarding', password: 'smoke-test-only' } });
    assert.equal(user.role, 'user');
    await api('/api/login', { method: 'POST', body: { username: 'onboarding', password: 'incorrect' }, status: 401 });
    const login = await api('/api/login', { method: 'POST', body: { username: 'onboarding', password: 'smoke-test-only' } });
    assert.equal((await api('/api/me', { token: login.token })).username, 'onboarding');
    await api('/api/accounts', { token: login.token, status: 403 });
    const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    assert.equal(admin.role, 'admin');
    assert.ok((await api('/api/accounts', { token: admin.token })).some(u => u.username === 'onboarding'));
    console.log('PASS: registration, login, identity and administrator authorization');
    const { io } = require(path.join(repo, 'server/node_modules/socket.io/client-dist/socket.io.js'));
    for (const token of [login.token, admin.token]) {
      const socket = io(base, { transports: ['websocket'], autoConnect: false, reconnection: false });
      sockets.push(socket);
      const connected = event(socket, 'connect');
      socket.connect();
      await connected;
      const joined = event(socket, 'message_history');
      socket.emit('join', { token, roomId: 'default' });
      await joined;
    }
    const content = '**onboarding** <script>alert(1)</script>';
    const received = event(sockets[1], 'message', m => m.content === content);
    sockets[0].emit('send_message', { content, roomId: 'default' });
    const message = await received;
    assert.equal(message.username, 'onboarding');
    assert.equal(message.isMarkdown, true);
    assert.ok(message.processedContent.includes('<strong>onboarding</strong>'));
    assert.ok(!message.processedContent.includes('<script'));
    console.log('PASS: two WebSocket clients, message delivery and Markdown sanitization');
    const payload = 'BetterLanTalk onboarding upload\n';
    const uploaded = await api('/api/upload?room=default', { method: 'POST', token: login.token, body: payload, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'onboarding.txt', 'x-mime': 'text/plain' } });
    assert.equal(uploaded.success, true);
    const download = await fetch(base + uploaded.file.url);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), payload);
    assert.ok((await api('/api/files?room=default', { token: login.token })).some(f => f.storedName === uploaded.file.storedName));
    const fileMessage = event(sockets[1], 'message', m => m.type === 'file' && m.storedName === uploaded.file.storedName);
    sockets[0].emit('send_file', { storedName: uploaded.file.storedName, roomId: 'default' });
    assert.equal((await fileMessage).name, 'onboarding.txt');
    console.log('PASS: file upload, listing, exact download content and file message delivery');
    const room = await api('/api/rooms', { method: 'POST', token: admin.token, body: { roomId: 'smoke-room', roomName: 'Smoke room' } });
    assert.equal(room.room.id, 'smoke-room');
    assert.ok((await api('/api/rooms')).some(r => r.id === 'smoke-room'));
    await api('/api/rooms/smoke-room', { method: 'DELETE', token: admin.token });
    assert.ok(!(await api('/api/rooms')).some(r => r.id === 'smoke-room'));
    await api('/api/logout', { method: 'POST', token: login.token });
    await api('/api/me', { token: login.token, status: 401 });
    console.log('PASS: room creation/deletion and logout invalidation');
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGINT');
      await stopped;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('chat accounts, local assets, two WebSocket clients, uploads and rooms', { timeout: 30000 }, smoke);
