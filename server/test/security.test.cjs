const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { fixture } = require('./fixture.cjs');
const { openProtectedStore } = require('../protected-store');
const login = (f, username = 'admin', password = '=Aa1357924680') => f.api('/api/login', null, { method: 'POST', body: { username, password } });
const read = file => fs.readFileSync(file, 'utf8');
function rejectedStart(f, initialize = false) {
    const result = spawnSync(process.execPath, ['server.js', ...(initialize ? ['--init-security'] : [])], {
        cwd: f.dir, env: { ...process.env, LANTALK_SECURITY_DIR: f.securityDir, LANTALK_OPEN_BROWSER: '0', PORT: '0' }, encoding: 'utf8', timeout: 5000
    });
    assert.equal(result.status, 1, result.stderr); return result.stderr;
}
test('signed state restores modified configuration and every authentication field before restart authentication', { timeout: 60000 }, async t => {
    const f = await fixture(); t.after(f.cleanup);
    const admin = await login(f);
    const alice = await f.api('/api/register', null, { method: 'POST', body: { username: 'alice', password: 'alice-password' } });
    const userFile = path.join(f.dir, 'users.json'), configFile = path.join(f.dir, 'config.json');
    const original = read(userFile), oldConfig = read(configFile);
    for (const change of [
        value => value.users.find(user => user.username === 'alice').role = 'admin',
        value => value.users.find(user => user.username === 'alice').role = 'superadmin',
        value => { const user = value.users.find(user => user.username === 'admin'); user.passwordHash = crypto.scryptSync('hacked-password', user.salt, 64).toString('hex'); },
        value => value.users.find(user => user.username === 'admin').boundIp = '127.0.0.99',
        value => value.tokens['forged-token'] = { username: 'admin', role: 'superadmin', expiresAt: Date.now() + 60000 }
    ]) {
        await f.stop(); const changed = JSON.parse(original); change(changed); fs.writeFileSync(userFile, JSON.stringify(changed));
        fs.writeFileSync(configFile, JSON.stringify({ port: 1, maxFileMB: 1, admin: true, role: 'superadmin' }));
        await f.start(); assert.equal(read(userFile), original); assert.equal(read(configFile), oldConfig);
        assert.equal((await f.api('/api/me', admin.token)).role, 'superadmin');
        await f.api('/api/accounts', alice.token, { status: 403 }); await f.api('/api/me', 'forged-token', { status: 401 });
    }
    // Startup repair happens before JSON parsing, even with both projections gone or broken.
    await f.stop(); fs.unlinkSync(userFile); fs.writeFileSync(configFile, '{broken'); await f.start();
    assert.equal(read(userFile), original); assert.equal(read(configFile), oldConfig);
    const forged = JSON.parse(original); forged.users.find(user => user.username === 'alice').role = 'superadmin';
    forged.tokens['forged-token'] = { username: 'admin', expiresAt: Date.now() + 60000 };
    fs.writeFileSync(userFile, JSON.stringify(forged));
    await f.api('/api/accounts', alice.token, { sourceIp: '127.0.0.3', status: 403 });
    await f.api('/api/me', 'forged-token', { sourceIp: '127.0.0.2', status: 401 });
    // Idle detection restores without a request or any legitimate write.
    fs.writeFileSync(userFile, '{broken'); fs.unlinkSync(configFile);
    await new Promise(resolve => setTimeout(resolve, 2300));
    assert.equal(read(userFile), original); assert.equal(read(configFile), oldConfig);
    assert.match(f.output(), /已从可信状态恢复 users.json/);
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(f.securityDir).mode & 0o777, 0o700);
        for (const name of ['key', 'state.json']) assert.equal(fs.statSync(path.join(f.securityDir, name)).mode & 0o777, 0o600);
    } else {
        // Inspect the actual ACL, including inherited key/state permissions, without module autoload.
        const script = '$ErrorActionPreference="Stop"; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ' +
            '$directory=$env:LANTALK_ACL_DIRECTORY; $acl=[System.IO.Directory]::GetAccessControl($directory); ' +
            'if(!$acl.AreAccessRulesProtected){throw "Directory inherits permissions"}; ' +
            'foreach($file in @($directory,($directory+"\\key"),($directory+"\\state.json"))) {' +
            'if([System.IO.Directory]::Exists($file)){$a=[System.IO.Directory]::GetAccessControl($file)}else{$a=[System.IO.File]::GetAccessControl($file)}; ' +
            '$rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); ' +
            'if($rules.Count -ne 2){throw "Unexpected ACL entries"}; ' +
            'foreach($rule in $rules){if($rule.IdentityReference.Value -notin @($sid,"S-1-5-18") -or $rule.AccessControlType -ne "Allow" -or ' +
            '$rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl){throw "Unexpected ACL permission"}}}';
        execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script],
            { env: { ...process.env, LANTALK_ACL_DIRECTORY: f.securityDir }, stdio: 'pipe', windowsHide: true });
    }
});
test('legal config, password, role, rename, IP and session changes become the latest recovery baseline', { timeout: 30000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); const admin = await login(f);
    const alice = await f.api('/api/register', null, { method: 'POST', body: { username: 'alice', password: 'alice-password' } });
    const oldUsers = read(path.join(f.dir, 'users.json')), oldConfig = read(path.join(f.dir, 'config.json'));
    for (const body of [{ port: 1.5 }, { maxFileMB: 'Infinity' }, { maxUploadsMB: 'Infinity' }]) await f.api('/api/config', admin.token, { method: 'PUT', body, status: 400 });
    await f.api('/api/config', admin.token, { method: 'PUT', body: { port: 3999, maxFileMB: 64, maxUploadsMB: 128, jiyuPort: 4999 } });
    await f.api('/api/users/alice/role', admin.token, { method: 'PUT', body: { role: 'admin' } });
    await f.api('/api/users/alice/role', admin.token, { method: 'PUT', body: { role: 'superadmin' }, status: 400 });
    await f.api('/api/users/admin', admin.token, { method: 'PUT', body: { newUsername: 'owner', newPassword: 'new-owner-password' } });
    await f.api('/api/accounts/' + (await f.api('/api/me', alice.token)).id + '/ip-binding', admin.token, { method: 'PUT', body: { ip: '127.0.0.50' } });
    const latest = read(path.join(f.dir, 'users.json'));
    await f.stop(); fs.writeFileSync(path.join(f.dir, 'users.json'), oldUsers); fs.writeFileSync(path.join(f.dir, 'config.json'), oldConfig);
    await f.start(); assert.equal(read(path.join(f.dir, 'users.json')), latest);
    assert.equal((await f.api('/api/config', admin.token)).jiyuPort, 4999);
    const owner = await login(f, 'owner', 'new-owner-password'); assert.equal(owner.role, 'superadmin');
    assert.equal((await f.api('/api/me', owner.token)).boundIp, '127.0.0.2');
    await f.api('/api/me', alice.token, { status: 401 });
});
test('damaged private state or missing keys fail closed even with explicit initialization', { timeout: 30000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); await login(f); await f.stop();
    const userFile = path.join(f.dir, 'users.json'), original = read(userFile), keyFile = path.join(f.securityDir, 'key'), stateFile = path.join(f.securityDir, 'state.json');
    const originalKey = fs.readFileSync(keyFile), originalState = read(stateFile);
    for (const mutation of [
        () => fs.writeFileSync(keyFile, crypto.randomBytes(32)),
        () => fs.unlinkSync(keyFile),
        () => fs.writeFileSync(stateFile, '{broken'),
        () => { const state = JSON.parse(originalState); state.payload.users.users[0].role = 'user'; fs.writeFileSync(stateFile, JSON.stringify(state)); }
    ]) {
        mutation(); assert.match(rejectedStart(f, true), /安全存储/); assert.equal(read(userFile), original);
        fs.writeFileSync(keyFile, originalKey); fs.writeFileSync(stateFile, originalState);
    }
    fs.renameSync(f.securityDir, f.securityDir + '-missing');
    assert.match(rejectedStart(f, true), /私有目录丢失/); assert.equal(read(userFile), original);
});
test('upgrade requires explicit trusted initialization and never promotes an account or accepts duplicate superadmins', { timeout: 30000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); await f.stop();
    fs.rmSync(f.securityDir, { recursive: true }); fs.unlinkSync(path.join(f.dir, '.security-initialized'));
    assert.match(rejectedStart(f), /--init-security/);
    const file = path.join(f.dir, 'users.json'), valid = JSON.parse(read(file));
    for (const users of [[], valid.users.map(user => ({ ...user, role: 'admin' })), [...valid.users, { ...valid.users[0], id: 'other', username: 'other' }]]) {
        fs.writeFileSync(file, JSON.stringify({ users, tokens: {} }));
        assert.match(rejectedStart(f, true), /恰好一名超级管理员/); assert.equal(fs.existsSync(f.securityDir), false);
    }
    fs.writeFileSync(file, 'null'); assert.match(rejectedStart(f, true), /缺少有效账号文件/);
    fs.unlinkSync(file); assert.match(rejectedStart(f, true), /缺少有效账号文件/);
    fs.writeFileSync(file, JSON.stringify(valid)); await f.start(true);
    assert.equal((await login(f)).role, 'superadmin');
});
test('private storage cannot be placed inside public data and a second service cannot overwrite it', { timeout: 30000 }, async t => {
    const f = await fixture(); t.after(f.cleanup);
    assert.throws(() => openProtectedStore({ dataDir: f.dir, securityDir: path.join(f.dir, 'security'), initialState() {} }), /数据目录之外/);
    assert.match(rejectedStart(f), /已有服务实例/);
});
test('private corruption during runtime stops the service instead of signing or resetting it', { timeout: 15000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); await login(f);
    const file = path.join(f.dir, 'users.json'), original = read(file);
    fs.writeFileSync(path.join(f.securityDir, 'state.json'), '{broken');
    await new Promise(resolve => setTimeout(resolve, 2300));
    assert.match(f.output(), /安全存储失败，服务已停止/); assert.equal(read(file), original);
    assert.match(rejectedStart(f, true), /安全存储/); assert.equal(read(file), original);
});
