const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const jiyu = require('../jiyu');

test('极域弹窗消息文本格式化规范', () => {
    // 简短消息
    const f1 = jiyu.formatJiyuMessage('公共聊天室', '张三', '你好世界');
    assert.equal(f1, '[公共聊天室 | 来自: 张三]: 你好世界');

    // 多行消息自适应
    const f2 = jiyu.formatJiyuMessage('竞赛组', '李四', '第一行\n第二行');
    assert.equal(f2, '[竞赛组 | 来自: 李四]: 发送了一条长消息，请自行打开查看');

    // 超长文本自适应
    const f3 = jiyu.formatJiyuMessage('公共聊天室', '王五', 'a'.repeat(90));
    assert.equal(f3, '[公共聊天室 | 来自: 王五]: 发送了一条长消息，请自行打开查看');

    // 文件消息
    const f4 = jiyu.formatJiyuMessage('公共聊天室', '赵六', '', true, '题解.pdf');
    assert.equal(f4, '[公共聊天室 | 来自: 赵六]: 发送了文件 "题解.pdf"');
});

test('极域 DMOC 数据包结构与 UTF-16LE 编码校验', () => {
    const testText = 'Hello 极域测试 123';
    const packet = jiyu.buildMessagePacket(testText);

    assert.equal(packet.length, 954, '极域数据包长度必须为 954 字节');
    // 前 4 字节必须是 DMOC
    assert.equal(packet.toString('ascii', 0, 4), 'DMOC');
    // 偏移量 56 处必须是 UTF-16LE 文本
    const decoded = packet.toString('utf16le', 56, 56 + testText.length * 2);
    assert.equal(decoded, testText);
});

test('本地 UDP 接收与发包验证', async () => {
    const server = dgram.createSocket('udp4');
    const testPort = 14788;
    const testMsg = '[测试房间 | 来自: 单元测试]: UDP连通性验证';

    await new Promise(resolve => server.bind(testPort, '127.0.0.1', resolve));

    const receivedPromise = new Promise(resolve => {
        server.on('message', (msg) => {
            assert.equal(msg.length, 954);
            const content = msg.toString('utf16le', 56, 56 + testMsg.length * 2);
            assert.equal(content, testMsg);
            server.close();
            resolve();
        });
    });

    jiyu.sendJiyuPopup(['127.0.0.1'], testPort, testMsg);
    await receivedPromise;
});
