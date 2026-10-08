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

/**
 * 格式化极域弹窗提示文本
 * 规则：
 * 1. 文件消息：[房间名 | 来自: 昵称]: 发送了文件 "文件名"
 * 2. 简短文字：[房间名 | 来自: 昵称]: 消息内容
 * 3. 超长文字（>80字或多行）：[房间名 | 来自: 昵称]: 发送了一条长消息，请自行打开查看
 * @param {string} roomName 房间名称
 * @param {string} sender 发信人昵称
 * @param {string} content 消息正文
 * @param {boolean} isFile 是否为文件消息
 * @param {string} fileName 文件名
 * @returns {string}
 */
function formatJiyuMessage(roomName, sender, content, isFile = false, fileName = '') {
    const room = roomName || '聊天室';
    const from = sender || '某人';
    if (isFile) {
        return `[${room} | 来自: ${from}]: 发送了文件 "${fileName || '未知文件'}"`;
    }
    const clean = String(content || '').trim();
    if (clean.length > 80 || clean.includes('\n')) {
        return `[${room} | 来自: ${from}]: 发送了一条长消息，请自行打开查看`;
    }
    return `[${room} | 来自: ${from}]: ${clean}`;
}

/**
 * 发送极域 UDP 弹窗至目标 IP 列表
 * @param {string[]} targetIps 目标 IP 数组
 * @param {number} port 目标端口 (通常为 4705, 4605, 4988 等)
 * @param {string} text 格式化后的消息内容
 * @param {function} [callback] 发送完成回调
 */
function sendJiyuPopup(targetIps, port, text, callback) {
    if (!Array.isArray(targetIps) || !targetIps.length) {
        if (typeof callback === 'function') callback(null, { sent: 0 });
        return;
    }

    const uniqueIps = Array.from(new Set(
        targetIps.map(ip => String(ip || '').trim()).filter(ip => {
            // 过滤无效 IP 或空值，允许局域网 IP 及本地回环 127.0.0.1
            return ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
        })
    ));

    if (!uniqueIps.length) {
        if (typeof callback === 'function') callback(null, { sent: 0 });
        return;
    }

    const packet = buildMessagePacket(text);
    const targetPort = Number(port) || 4705;
    const client = dgram.createSocket('udp4');
    let sentCount = 0;
    let completed = 0;

    const finalize = () => {
        try { client.close(); } catch (e) {}
        if (typeof callback === 'function') {
            callback(null, { sent: sentCount, total: uniqueIps.length });
        }
    };

    uniqueIps.forEach(ip => {
        client.send(packet, targetPort, ip, (err) => {
            if (err) {
                console.error(`[极域] 发送至 ${ip}:${targetPort} 失败:`, err.message);
            } else {
                sentCount++;
            }
            completed++;
            if (completed >= uniqueIps.length) {
                finalize();
            }
        });
    });

    // 超时兜底关闭 socket
    setTimeout(() => {
        if (completed < uniqueIps.length) finalize();
    }, 1500);
}

module.exports = {
    HEADER_BYTES,
    PACKET_TOTAL_SIZE,
    TEXT_OFFSET,
    MAX_TEXT_CHARS,
    buildMessagePacket,
    formatJiyuMessage,
    sendJiyuPopup
};
