// Run the standalone binary with no checkout, node_modules, or Node.js on PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { request } = require('./network.cjs');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');
const { receive } = require('./fixture.cjs');

(async () => {
  const name = process.platform === 'win32' ? 'BetterLanTalk-win-x64.exe' : 'BetterLanTalk-linux-x64';
  const source = path.resolve(process.argv[2] || path.join(__dirname, '../../dist', name));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantalk-packaged-'));
  const binDir = path.join(root, 'bin'), cwd = path.join(root, 'empty-workdir');
  fs.mkdirSync(binDir); fs.mkdirSync(cwd);
  const binary = path.join(binDir, path.basename(source)); fs.copyFileSync(source, binary); fs.chmodSync(binary, 0o755);
  const data = path.join(binDir, 'data');
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  let child, socket, output = '';
  async function start(dataOverride) {
    const env = { ...process.env, PORT: String(port), LANTALK_SECURITY_DIR: path.join(root, dataOverride ? 'private-custom' : 'private'), PATH: cwd, LANTALK_OPEN_BROWSER: '0' };
    delete env.NODE_PATH; delete env.NODE_OPTIONS; delete env.LANTALK_DATA_DIR;
    if (dataOverride) env.LANTALK_DATA_DIR = dataOverride;
    child = spawn(binary, [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    let spawnError; child.on('error', error => { spawnError = error; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, output);
      try { if ((await request(base + '/api/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Packaged server failed to start: ' + output);
  }
  async function stop() {
    socket?.disconnect(); socket = null;
    if (child?.exitCode === null && child.signalCode === null) {
      const done = once(child, 'close'); child.kill('SIGINT'); await done;
    }
  }
  async function api(route, token, { status = 200, body, headers = {}, ...options } = {}) {
    const response = await request(base + route, { ...options,
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body && typeof body === 'object' && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body });
    const text = await response.text(); assert.equal(response.status, status, route + ': ' + text.slice(0, 200));
    try { return JSON.parse(text); } catch { return text; }
  }
  try {
    await start();
    assert.equal((await api('/api/status')).version, require('../package.json').version);
    assert.ok(fs.existsSync(path.join(data, 'users.json')));
    assert.deepEqual(fs.readdirSync(cwd), []);
    assert.match(await api('/'), /BetterLanTalk/);
    await api('/client/chat.js', null, { status: 401 });
    const login = await api('/api/login', null, { method: 'POST', body: { username: 'admin', password: '=Aa1357924680' } });
    const token = login.token;
    assert.match(await api('/chat', token), /id="send-mode-toggle"/);
    for (const route of ['/chat', '/admin', '/client/chat.js', '/client/context-menu.js', '/client/community-ui.js', '/client/community.css', '/client/icons.js', '/client/message-policy.js', '/client/emoji-data.js', '/assets/qq/14.png', '/client/composer.js', '/client/admin.js',
      '/client/vendor/luogu-markdown-editor/luogu-parser.js', '/socket.io/socket.io.js',
      '/assets/katex/katex.min.js', '/assets/katex/katex.min.css', '/assets/katex/fonts/KaTeX_Main-Regular.woff2',
      '/assets/prism/prism.js', '/assets/prism/themes/prism.css', '/assets/purify.js',
      ...['c', 'cpp', 'python', 'bash', 'json', 'java', 'rust', 'go', 'pascal', 'latex'].map(language => '/assets/prism/components/prism-' + language + '.min.js')]) {
      const response = await request(base + route, { headers: { authorization: 'Bearer ' + token } });
      assert.equal(response.status, 200, route); assert.ok((await response.text()).length > 0, route);
    }
    socket = io(base, { transports: ['websocket'], autoConnect: false, reconnection: false });
    const connected = receive(socket, 'connect'); socket.connect(); await connected;
    const joined = receive(socket, 'message_history'); socket.emit('join', { token }); await joined;
    const content = '**standalone** :qq[14]: $x^2$\n\n```cpp\nint main() {}\n```\n\n:::info[打包验证]{open}\n本地资源\n:::';
    const delivered = receive(socket, 'message', message => message.content === content);
    socket.emit('send_message', { roomId: 'default', content });
    const message = await delivered;
    assert.match(message.processedContent, /qq-emoji/); assert.match(message.processedContent, /katex/); assert.match(message.processedContent, /token keyword/); assert.match(message.processedContent, /<details/);
    const file = (await api('/api/upload?room=default', token, { method: 'POST', body: 'standalone upload', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'standalone.txt' } })).file;
    assert.equal(await api(file.url, token), 'standalone upload');
    const group = (await api('/api/groups', token, { method: 'POST', body: { name: '独立程序群组', isPublic: false } })).room;
    await api('/api/groups/' + group.id, token, { method: 'PUT', body: { announcement: 'persisted announcement' } });
    await api('/api/rooms/' + group.id + '/settings', token, { method: 'PUT', body: { notificationMode: 'important' } });
    await api('/api/preferences', token, { method: 'PUT', body: { preview: false, theme: 'dark', sendMode: 'enter' } });
    const bot = await api('/api/bots', token, { method: 'POST', body: { username: 'standalonebot' } });
    assert.equal((await api('/api/bot/v1/me', bot.token)).kind, 'bot');
    const { PNG } = require('pngjs'), png = new PNG({ width: 2, height: 2 }); png.data.fill(255);
    const avatar = await api('/api/me/avatar', token, { method: 'PUT', body: PNG.sync.write(png), headers: { 'content-type': 'application/octet-stream' } });
    assert.ok(fs.existsSync(path.join(data, 'avatars', path.basename(avatar.avatar))));
    await api('/api/config', token, { method: 'PUT', body: { jiyuPort: 4999 } });
    // Only the private signed state survives these malicious edits.
    const trustedAccounts = fs.readFileSync(path.join(data, 'users.json'), 'utf8');
    fs.writeFileSync(path.join(data, 'config.json'), '{broken');
    const changed = JSON.parse(trustedAccounts); changed.users.push({ id: 'evil', username: 'evil', role: 'superadmin' });
    fs.writeFileSync(path.join(data, 'users.json'), JSON.stringify(changed));
    await stop(); await start();
    assert.equal(fs.readFileSync(path.join(data, 'users.json'), 'utf8'), trustedAccounts);
    assert.ok(fs.existsSync(path.join(root, 'private', 'key')));
    assert.equal((await api('/api/me', token)).boundIp, '127.0.0.1');
    assert.equal((await api('/api/config', token)).jiyuPort, 4999);
    assert.equal((await api('/api/groups/' + group.id, token)).announcement, 'persisted announcement');
    assert.equal((await api('/api/rooms', token)).find(room => room.id === group.id).settings.notificationMode, 'important');
    assert.equal((await api('/api/preferences', token)).preview, false);
    assert.equal((await api('/api/preferences', token)).sendMode, 'enter');
    assert.equal((await api('/api/me', token)).avatar, avatar.avatar);
    assert.equal((await api('/api/bot/v1/me', bot.token)).username, 'standalonebot');
    assert.ok((await api('/api/rooms/default/messages', token)).some(saved => saved.id === message.id));
    assert.equal(await api(file.url, token), 'standalone upload');
    await stop();
    const override = path.join(root, 'custom-data'); await start(override);
    assert.ok(fs.existsSync(path.join(override, 'users.json')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(override, 'users.json'))).users[0].boundIp, '');
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'users.json'))).users[0].boundIp, '127.0.0.1');
    console.log('PASS: standalone startup without Node.js/checkout, all embedded assets, protected pages, Markdown/QQ emoji, WebSocket, upload/download, group/Bot/avatars/preferences restart persistence and custom data directory');
  } catch (error) { console.error(output); throw error; }
  finally { await stop(); await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
