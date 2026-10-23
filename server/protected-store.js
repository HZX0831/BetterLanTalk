'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { isIPv4 } = require('net');
const { execFileSync } = require('child_process');
const clone = value => JSON.parse(JSON.stringify(value));
const json = value => JSON.stringify(value, null, 2) + '\n';
const failure = message => new Error('安全存储：' + message + '；请恢复数据目录及对应私有保护目录的可信备份，禁止重新初始化覆盖');

function defaultDirectory(dataDir) {
    const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
        : process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    const identity = crypto.createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0, 24);
    return path.join(base, 'BetterLanTalk', 'security', identity);
}
function secureDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(directory).isSymbolicLink()) throw failure('私有目录不能是符号链接');
    if (process.platform === 'win32') {
        // Use absolute system paths: standalone builds deliberately work without system tools on PATH.
        const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
        const script = '$ErrorActionPreference="Stop"; $acl=New-Object System.Security.AccessControl.DirectorySecurity; ' +
            '$acl.SetAccessRuleProtection($true,$false); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid); ' +
            'foreach($id in @($sid,(New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")))) {' +
            '$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($id,"FullControl","ContainerInherit,ObjectInherit","None","Allow"); $acl.AddAccessRule($rule)}; ' +
            '[System.IO.Directory]::SetAccessControl($env:LANTALK_ACL_DIRECTORY,$acl)';
        execFileSync(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script],
            { env: { ...process.env, LANTALK_ACL_DIRECTORY: directory }, stdio: 'pipe', windowsHide: true });
    } else {
        if (fs.statSync(directory).uid !== process.getuid()) throw failure('私有目录不属于当前服务账号');
        fs.chmodSync(directory, 0o700);
    }
}
function atomicWrite(file, content) {
    const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let descriptor;
    try {
        descriptor = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
        fs.renameSync(temporary, file);
        // Persist the rename as well as the contents on POSIX filesystems.
        if (process.platform !== 'win32') { const parent = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); } }
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}
function validate(payload) {
    const { config, users, superadminId } = payload;
    if (!config || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
        !Number.isFinite(config.maxFileMB) || config.maxFileMB <= 0 || !Number.isFinite(config.maxUploadsMB) || config.maxUploadsMB < config.maxFileMB ||
        typeof config.serverIP !== 'string' || config.serverIP !== '' && !isIPv4(config.serverIP) || typeof config.jiyuEnabled !== 'boolean' || !Number.isInteger(config.jiyuPort) || config.jiyuPort < 1 || config.jiyuPort > 65535) throw failure('配置格式无效');
    if (!Array.isArray(users?.users) || !users.tokens || typeof users.tokens !== 'object' || Array.isArray(users.tokens)) throw failure('账号数据格式无效');
    const administrators = users.users.filter(user => user.role === 'superadmin');
    if (administrators.length !== 1 || administrators[0].id !== superadminId || administrators[0].kind === 'bot') throw failure('必须且只能保留原有唯一超级管理员');
    const ids = new Set(), names = new Set();
    for (const user of users.users) {
        if (!user.id || typeof user.id !== 'string' || ids.has(user.id) || typeof user.username !== 'string' || !user.username || names.has(user.username) ||
            !['user', 'admin', 'superadmin'].includes(user.role) || ![undefined, 'human', 'bot'].includes(user.kind) || typeof user.boundIp !== 'string' ||
            (user.kind === 'bot' ? user.role !== 'user' || typeof user.botTokenHash !== 'string' : typeof user.salt !== 'string' || typeof user.passwordHash !== 'string')) throw failure('账号身份或角色无效');
        ids.add(user.id); names.add(user.username);
    }
}
function lockDirectory(directory) {
    const file = path.join(directory, 'lock');
    if (fs.existsSync(file)) {
        let pid;
        try { pid = Number(fs.readFileSync(file, 'utf8')); } catch { throw failure('无法读取服务锁'); }
        if (!Number.isSafeInteger(pid) || pid <= 0) throw failure('服务锁损坏');
        try { process.kill(pid, 0); throw failure('此安全存储已有服务实例运行'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        fs.unlinkSync(file);
    }
    const descriptor = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(descriptor, String(process.pid)); fs.closeSync(descriptor);
    const release = () => { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
    process.once('exit', release);
    return () => { process.removeListener('exit', release); release(); };
}

function openProtectedStore({ dataDir, securityDir = process.env.LANTALK_SECURITY_DIR || defaultDirectory(dataDir), initialize = false, initialState, log = console.warn }) {
    fs.mkdirSync(dataDir, { recursive: true });
    dataDir = fs.realpathSync(dataDir); securityDir = path.resolve(securityDir);
    fs.mkdirSync(path.dirname(securityDir), { recursive: true });
    // Resolve parent symlinks before checking containment.
    securityDir = path.join(fs.realpathSync(path.dirname(securityDir)), path.basename(securityDir));
    const relative = path.relative(dataDir, securityDir);
    if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw failure('私有保护目录必须位于数据目录之外');
    const keyFile = path.join(securityDir, 'key'), stateFile = path.join(securityDir, 'state.json');
    const marker = path.join(dataDir, '.security-initialized');
    const existing = fs.existsSync(securityDir);
    let key, envelope, close;
    const sign = payload => crypto.createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
    if (existing) {
        secureDirectory(securityDir);
        try {
            for (const file of [keyFile, stateFile]) { if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('不是普通文件'); if (process.platform !== 'win32') fs.chmodSync(file, 0o600); }
            key = fs.readFileSync(keyFile); envelope = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch { throw failure('密钥或可信快照丢失/损坏'); }
        if (key.length !== 32 || !/^[a-f0-9]{64}$/.test(envelope.mac || '') || !envelope.payload ||
            !crypto.timingSafeEqual(Buffer.from(envelope.mac, 'hex'), Buffer.from(sign(envelope.payload), 'hex'))) throw failure('可信快照完整性校验失败');
        if (envelope.payload.version !== 1 || !Number.isSafeInteger(envelope.payload.revision)) throw failure('可信快照版本无效');
        validate(envelope.payload); close = lockDirectory(securityDir);
    } else {
        if (fs.existsSync(marker)) throw failure('已启用保护但私有目录丢失');
        const hasData = ['config.json', 'users.json', 'rooms.json', 'community.json', 'messages.json', 'social.json', 'files.json'].some(file => fs.existsSync(path.join(dataDir, file)));
        if (hasData && !initialize) throw new Error('现有数据尚未建立安全基线。请备份并确认恰好一名超级管理员后，使用 --init-security 显式初始化。');
        const state = initialState();
        const payload = { version: 1, revision: 1, superadminId: state.users.users.find(user => user.role === 'superadmin')?.id, ...state };
        validate(payload); // Never create a key or sign invalid legacy roles.
        // Exclusive creation also prevents two first launches from creating different keys.
        fs.mkdirSync(securityDir, { mode: 0o700 }); secureDirectory(securityDir); close = lockDirectory(securityDir); key = crypto.randomBytes(32);
        atomicWrite(keyFile, key); envelope = { payload, mac: sign(payload) }; atomicWrite(stateFile, json(envelope));
        log('已建立安全基线；请同时备份数据目录和私有保护目录：' + securityDir);
    }
    let current = clone(envelope.payload);
    function checkTrusted() {
        try {
            if (fs.lstatSync(keyFile).isSymbolicLink() || fs.lstatSync(stateFile).isSymbolicLink() || !fs.readFileSync(keyFile).equals(key)) throw new Error('密钥变化');
            const disk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            if (disk.mac !== sign(current) || JSON.stringify(disk.payload) !== JSON.stringify(current)) throw new Error('可信快照变化');
        } catch { throw failure('运行期间密钥或可信快照发生变化'); }
    }
    function repair(quiet = false) {
        checkTrusted();
        for (const [name, value] of [['config.json', current.config], ['users.json', current.users]]) {
            const file = path.join(dataDir, name), expected = json(value);
            let actual; try { if (!fs.lstatSync(file).isSymbolicLink()) actual = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (actual !== expected) { atomicWrite(file, expected); if (!quiet) log('已从可信状态恢复 ' + name + '（版本 ' + current.revision + '）'); }
        }
        if (!fs.existsSync(marker)) atomicWrite(marker, '1\n');
    }
    repair(!existing);
    return {
        securityDir, state: clone(current), repair, close,
        commit(patch) {
            repair();
            const next = { ...current, ...clone(patch), revision: current.revision + 1 };
            // Anchor cannot be changed by callers or ordinary role mutations.
            next.superadminId = current.superadminId; validate(next);
            atomicWrite(stateFile, json({ payload: next, mac: sign(next) }));
            current = next; repair(true);
        }
    };
}
module.exports = { openProtectedStore, defaultDirectory, atomicWrite };
