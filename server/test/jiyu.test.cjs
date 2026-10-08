const { test } = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { formatJiyuMessage, buildMessagePacket, sendJiyuPopup, createJiyuNotifier } = require('../jiyu');
test('popups include the sender, fixed labels and the requested flie spelling', () => {
  for (const [message, expected] of [[{ content: 'secret', username: 'secret' }, 'from secret: new message'], [{ type: 'admin', username: 'admin', content: 'secret' }, 'from admin: new message'], [{ type: 'file', username: 'alice', name: 'secret' }, 'from alice: new flie'], [{ type: 'file', username: 'bob', isImage: true }, 'from bob: new picture']]) {
    assert.equal(formatJiyuMessage(message), expected); const packet = buildMessagePacket(expected);
    assert.equal(packet.length, 954); assert.equal(packet.subarray(0,4).toString(), 'DMOC');
    assert.equal(packet.subarray(56).toString('utf16le').replace(/\0.*$/s, ''), expected);
  }
});
test('UDP failures are reported once even if the socket also raises an error', async () => {
  const client = new EventEmitter(); client.close = () => {}; let count = 0;
  client.send = (packet, port, ip, callback) => { callback(new Error('send failed')); client.emit('error', new Error('socket failed')); };
  sendJiyuPopup(['127.0.0.1'], 4705, 'new message', (error, result) => {
    count++; assert.ok(error); assert.deepEqual(result, { sent: 0, total: 1, failed: 1 });
  }, () => client);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(count, 1);
});
test('UDP validates addresses and ports and deduplicates targets', () => {
  for (const [ips, port] of [[['999.2.3.4'], 4705], [['127.0.0.1'], 0], [['127.0.0.1'], 1.5]]) sendJiyuPopup(ips, port, 'new message', error => assert.ok(error));
  const client = new EventEmitter(); let sends = 0; client.close = () => {}; client.send = (packet, port, ip, cb) => { sends++; cb(null); };
  sendJiyuPopup(['127.0.0.1', '127.0.0.1'], 4705, 'new message', (error, result) => { assert.ifError(error); assert.equal(result.sent, 1); }, () => client);
  assert.equal(sends, 1);
});

test('each IP shares a 20-second cooldown across senders and message kinds; dropped messages never extend it', () => {
  let time = 1000; const sent = [];
  const notify = createJiyuNotifier({ now: () => time, send: (ips, port, text, cb) => { sent.push({ ips, text }); cb(null, { sent: ips.length, failed: 0 }); } });
  const first = ['127.0.0.2'];
  notify(first, 4705, { username: 'alice' });
  time = 20999;
  notify(first, 4705, { username: 'bob', type: 'file', isImage: true }, (error, result) => { assert.ifError(error); assert.equal(result.skipped, 1); assert.equal(result.sent, 0); });
  notify(['127.0.0.2', '127.0.0.3'], 4705, { username: 'charlie', type: 'file' });
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].ips, ['127.0.0.3']);
  time = 21000;
  notify(first, 4705, { username: 'bob', type: 'file', isImage: true });
  assert.equal(sent.length, 3); assert.equal(sent[2].text, 'from bob: new picture');
  assert.ok(!sent.some(packet => packet.ips.includes('127.0.0.2') && packet.text === 'from charlie: new flie'));
});
test('concurrent sends and send failures still reserve the device cooldown', () => {
  const callbacks = [], sent = [];
  const notify = createJiyuNotifier({ now: () => 0, send: (ips, port, text, cb) => { sent.push(ips); callbacks.push(cb); } });
  notify(['127.0.0.2'], 4705, { username: 'alice' }, error => assert.ok(error));
  notify(['127.0.0.2'], 4705, { username: 'bob' }, (error, result) => assert.equal(result.skipped, 1));
  callbacks[0](new Error('failed'), { sent: 0, failed: 1 });
  notify(['127.0.0.2'], 4705, { username: 'bob' }); assert.equal(sent.length, 1);
});
test('sender control characters cannot replace or split the fixed popup kind', () => {
  assert.equal(formatJiyuMessage({ username: 'alice\n\0bob', type: 'file' }), 'from alice  bob: new flie');
});
