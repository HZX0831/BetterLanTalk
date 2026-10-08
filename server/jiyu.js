const dgram = require('dgram');

// 极域电子教室消息数据包头 (56 字节)
// 来源于 1.py store[0]，总长度 954 字节
const HEADER_BYTES = [
    0x44, 0x4d, 0x4f, 0x43, 0x00, 0x00, 0x01, 0x00, 0x9e, 0x03, 0x00, 0x00, 0x10, 0x41, 0xaf, 0xfb,
    0xa0, 0xe7, 0x52, 0x40, 0x91, 0xdc, 0x27, 0xa3, 0xb6, 0xf9, 0x29, 0x2e, 0x20, 0x4e, 0x00, 0x00,
    0xc0, 0xa8, 0x50, 0x81, 0x91, 0x03, 0x00, 0x00, 0x91, 0x03, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00
];

const PACKET_TOTAL_SIZE = 954;
const TEXT_OFFSET = 56;
const MAX_TEXT_CHARS = 400; // 缓冲区最大可容纳 (954-56)/2 = 449 字符，取 400 确保安全留空

/**
 * 构造极域 UDP 弹窗数据包 (954 字节)
 * @param {string} text 要展示的消息文本
 * @returns {Buffer}
 */
function buildMessagePacket(text) {
    const packet = Buffer.alloc(PACKET_TOTAL_SIZE);
    // 拷贝 56 字节协议头
    for (let i = 0; i < HEADER_BYTES.length; i++) {
        packet[i] = HEADER_BYTES[i];
    }
    // 将文本以 UTF-16LE 写入第 56 字节开始的位置
    const safeText = String(text || '').slice(0, MAX_TEXT_CHARS);
    packet.write(safeText, TEXT_OFFSET, 'utf16le');
    return packet;
}

// Deliberately preserve the requested "flie" spelling and exclude message details.
function formatJiyuMessage(message = {}) {
    const kind = message.type === 'file' ? (message.isImage ? 'new picture' : 'new flie') : 'new message';
    const sender = String(message.username || '系统').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 20) || '系统';
    return `from ${sender}: ${kind}`;
}

function sendJiyuPopup(targetIps, port, text, callback = () => {}, createSocket = dgram.createSocket) {
    const { isIPv4 } = require('net');
    const ips = Array.isArray(targetIps) ? [...new Set(targetIps)] : [];
    if (!Number.isInteger(port) || port < 1 || port > 65535 || ips.some(ip => !isIPv4(ip))) {
        callback(new Error('Invalid target'), { sent: 0, total: ips.length, failed: ips.length });
        return;
    }
    if (!ips.length) return callback(null, { sent: 0, total: 0, failed: 0 });
    const client = createSocket('udp4');
    let sent = 0, completed = 0, done = false;
    const finish = error => {
        if (done) return;
        done = true; clearTimeout(timer);
        try { client.close(); } catch {}
        const result = { sent, total: ips.length, failed: ips.length - sent };
        callback(error || (result.failed ? new Error('UDP send failed') : null), result);
    };
    const timer = setTimeout(() => finish(new Error('UDP timeout')), 1500);
    client.on('error', finish);
    const packet = buildMessagePacket(text);
    for (const ip of ips) {
        if (done) break;
        try {
            client.send(packet, port, ip, error => {
                if (done) return;
                if (!error) sent++;
                if (++completed === ips.length) finish();
            });
        } catch (error) { finish(error); }
    }
}
const DEVICE_COOLDOWN_MS = 20000;
function createJiyuNotifier({ send = sendJiyuPopup, now = Date.now } = {}) {
    const nextAllowed = new Map();
    return function notify(ips, port, message, callback = () => {}) {
        const time = now();
        // Dropped notifications neither extend the window nor enter a replay queue.
        for (const [ip, until] of nextAllowed) if (until <= time) nextAllowed.delete(ip);
        const unique = [...new Set(ips)];
        const eligible = unique.filter(ip => !nextAllowed.has(ip));
        const skipped = unique.length - eligible.length;
        if (!eligible.length) return callback(null, { sent: 0, total: unique.length, failed: 0, skipped });
        // Reserve before asynchronous sending: concurrent messages and rooms share one cooldown.
        for (const ip of eligible) nextAllowed.set(ip, time + DEVICE_COOLDOWN_MS);
        send(eligible, port, formatJiyuMessage(message), (error, result) => callback(error, { ...result, total: unique.length, skipped }));
    };
}
module.exports = { HEADER_BYTES, PACKET_TOTAL_SIZE, TEXT_OFFSET, MAX_TEXT_CHARS, buildMessagePacket, formatJiyuMessage, sendJiyuPopup, createJiyuNotifier, DEVICE_COOLDOWN_MS };
