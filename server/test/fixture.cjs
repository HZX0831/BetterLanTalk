const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { once } = require('node:events'), { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { request, sourceFor } = require('./network.cjs');
const repo = path.resolve(__dirname, '../..');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');
function receive(socket, name, matches = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, listener); reject(new Error('Timeout: ' + name)); }, 4000);
    function listener(data) { if (!matches(data)) return; clearTimeout(timer); socket.off(name, listener); resolve(data); }
    socket.on(name, listener);
  });
}
async function fixture(seed = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantalk-social-')), dir = path.join(root, 'server'); fs.mkdirSync(dir);
  for (const file of fs.readdirSync(path.join(repo, 'server')).filter(file => file.endsWith('.js'))) fs.copyFileSync(path.join(repo, 'server', file), path.join(dir, file));
  fs.symlinkSync(path.join(repo, 'server/node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(repo, 'client'), path.join(root, 'client'), 'dir');
  for (const [file, data] of Object.entries(seed)) fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port, sockets = []; let child, output = '';
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port), LANTALK_OPEN_BROWSER: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, output);
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Startup failed: ' + output);
  }
  async function stop() {
    for (const socket of sockets.splice(0)) socket.disconnect();
    if (child?.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGINT'); await done; }
  }
  async function api(route, token, options = {}) {
    const { body, status = 200, headers = {}, sourceIp, ...rest } = options;
    const response = await request(base + route, { ...rest, localAddress: sourceIp || sourceFor(dir, token, typeof body === 'object' ? body?.username : undefined), headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await response.text(); assert.equal(response.status, status, route + ': ' + text.slice(0, 200));
    try { return JSON.parse(text); } catch { return text; }
  }
  async function connect(token, sourceIp) {
    const socket = io(base, { transports: ['websocket'], query: { sourceIp: sourceIp || sourceFor(dir, token) }, autoConnect: false, reconnection: false }); sockets.push(socket);
    const connected = receive(socket, 'connect'); socket.connect(); await connected;
    const joined = receive(socket, 'message_history'); socket.emit('join', { token }); await joined; return socket;
  }
  await start();
  return { root, dir, base, start, stop, api, connect, request: (route, token) => request(base + route, { localAddress: sourceFor(dir, token), headers: { authorization: 'Bearer ' + token } }), cleanup: async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); } };
}
module.exports = { fixture, receive };
