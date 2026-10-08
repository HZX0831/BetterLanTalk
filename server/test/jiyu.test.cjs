const { test } = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { formatJiyuMessage, buildMessagePacket, sendJiyuPopup } = require('../jiyu');
test('popups contain only fixed labels and retain the requested flie spelling', () => {
  for (const [message, expected] of [[{ content: 'secret', username: 'secret' }, 'new message'], [{ type: 'admin', content: 'secret' }, 'new message'], [{ type: 'file', name: 'secret' }, 'new flie'], [{ type: 'file', isImage: true }, 'new picture']]) {
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
