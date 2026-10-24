// Real loopback source addresses exercise IP rules without a production bypass.
const http = require('node:http'), net = require('node:net'), fs = require('node:fs'), path = require('node:path');
const WS = require('../node_modules/ws');
global.WebSocket = class SourceWebSocket extends WS {
  constructor(url, protocols) {
    super(url, protocols, { localAddress: new URL(url).searchParams.get('sourceIp') || '127.0.0.1' });
  }
};
function sourceFor(dir, token, username) {
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'));
  const name = store.tokens[token]?.username || username;
  const index = store.users.findIndex(user => user.username === name);
  return index >= 0 ? store.users[index].boundIp || store.users[index].registeredIp || '127.0.0.' + (index + 2)
    : name ? '127.0.0.' + (store.users.length + 2) : '127.0.0.1';
}
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET', headers: options.headers,
      localAddress: options.localAddress || '127.0.0.1', signal: options.signal, agent: false }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
          headers: { get: name => response.headers[name.toLowerCase()] ?? null },
          text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject); req.end(options.body);
  });
}
async function sourceProxy(port, sourceIp) {
  const sockets = new Set();
  const proxy = http.createServer((req, res) => {
    const outgoing = http.request({ hostname: '127.0.0.1', port, path: req.url, method: req.method,
      headers: req.headers, localAddress: sourceIp, agent: false }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    outgoing.on('error', error => { if (!res.headersSent) res.writeHead(502); res.end(error.message); }); req.pipe(outgoing);
  });
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('upgrade', (req, downstream, head) => {
    const upstream = net.connect({ host: '127.0.0.1', port, localAddress: sourceIp }, () => {
      const headers = req.rawHeaders.reduce((lines, value, i, values) => i % 2 ? lines : lines + value + ': ' + values[i+1] + '\r\n', '');
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n`); if (head.length) upstream.write(head);
      downstream.pipe(upstream); upstream.pipe(downstream);
    });
    sockets.add(upstream); upstream.on('close', () => { sockets.delete(upstream); downstream.destroy(); });
    downstream.on('close', () => upstream.destroy()); upstream.on('error', () => downstream.destroy()); downstream.on('error', () => upstream.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + proxy.address().port,
    close: () => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => proxy.close(resolve)); } };
}
module.exports = { request, sourceFor, sourceProxy };
