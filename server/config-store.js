'use strict';
const fs = require('fs');
const { isIPv4, isIP } = require('net');

const defaults = { port: 3001, maxFileMB: 5120, maxUploadsMB: 20480, serverIP: '', jiyuEnabled: false, jiyuPort: 4988, superadminIP: '' };
function readConfig(file) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { ...defaults }; throw new Error('无法读取 config.json：' + error.message); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config.json 必须是 JSON 对象');
    const config = Object.fromEntries(Object.keys(defaults).map(key => [key, raw[key] === undefined ? defaults[key] : raw[key]]));
    for (const key of ['port', 'maxFileMB', 'maxUploadsMB', 'jiyuPort']) config[key] = Number(config[key]);
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || !Number.isInteger(config.jiyuPort) || config.jiyuPort < 1 || config.jiyuPort > 65535 ||
        !Number.isFinite(config.maxFileMB) || config.maxFileMB <= 0 || !Number.isFinite(config.maxUploadsMB) || config.maxUploadsMB < config.maxFileMB || typeof config.jiyuEnabled !== 'boolean') throw new Error('config.json 中端口、上传限制或极域开关无效');
    if (typeof config.serverIP !== 'string' || config.serverIP !== '' && !isIPv4(config.serverIP)) throw new Error('config.json 中 serverIP 应为空或有效 IPv4 地址');
    if (typeof config.superadminIP !== 'string') throw new Error('config.json 中 superadminIP 应为空或有效 IP 地址');
    config.superadminIP = config.superadminIP.trim().replace(/^::ffff:/i, '');
    if (config.superadminIP && !isIP(config.superadminIP)) throw new Error('config.json 中 superadminIP 应为空或有效 IP 地址');
    return config;
}
function writeConfig(file, config) {
    fs.writeFileSync(file + '.tmp', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
}
module.exports = { readConfig, writeConfig };
