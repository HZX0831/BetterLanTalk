const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./fixture.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const password = '=Aa1357924680';
const login = (f, ip = '127.0.0.2', status = 200) => f.api('/api/login', null, { method: 'POST', sourceIp: ip, body: { username: 'admin', password }, status });
function expectStartupFailure(f, pattern) {
    const result = spawnSync(process.execPath, ['server.js'], { cwd: f.dir, env: { ...process.env, LANTALK_DATA_DIR: f.dir, LANTALK_OPEN_BROWSER: '0', PORT: '0' }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, pattern);
}
test('config JSON edits persist across idle periods and restart without any restore mechanism', { timeout: 30000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); const admin = await login(f);
    const file = path.join(f.dir, 'config.json'), current = read(file);
    current.jiyuPort = 5001; current.maxFileMB = 12; fs.writeFileSync(file, JSON.stringify(current));
    await new Promise(resolve => setTimeout(resolve, 2300)); assert.equal(read(file).jiyuPort, 5001);
    await f.stop(); await f.start(); assert.equal((await f.api('/api/config', admin.token)).jiyuPort, 5001);
    assert.equal((await f.api('/api/limits')).maxFileMB, 12);
    await f.stop(); fs.writeFileSync(file, '{broken'); expectStartupFailure(f, /config.json/); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
    fs.unlinkSync(file); await f.start(); assert.equal((await f.api('/api/config', admin.token)).jiyuPort, 4988);
});
test('obsolete safety markers and damaged old private files do not affect ordinary JSON loading', { timeout: 30000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); const admin = await login(f); await f.stop();
    const oldPrivate = path.join(f.root, 'old-private'); fs.mkdirSync(oldPrivate);
    fs.writeFileSync(path.join(oldPrivate, 'state.json'), '{broken'); fs.writeFileSync(path.join(oldPrivate, 'key'), 'obsolete');
    fs.writeFileSync(path.join(f.dir, '.security-initialized'), '1');
    const file = path.join(f.dir, 'config.json'), config = read(file); config.jiyuPort = 5002; fs.writeFileSync(file, JSON.stringify(config));
    await f.start(); assert.equal((await f.api('/api/config', admin.token)).jiyuPort, 5002);
    assert.equal((await f.api('/api/me', admin.token)).boundIp, '127.0.0.2');
    assert.equal(fs.readFileSync(path.join(oldPrivate, 'state.json'), 'utf8'), '{broken');
});
test('JSON pins the initial superadmin IP and changing it revokes sessions without changing identity', { timeout: 30000 }, async t => {
    const f = await fixture({ 'config.json': { superadminIP: '127.0.0.9' } }); t.after(f.cleanup);
    await login(f, '127.0.0.2', 403); const owner = await login(f, '127.0.0.9');
    const me = await f.api('/api/me', owner.token, { sourceIp: '127.0.0.9' }); assert.equal(me.boundIp, '127.0.0.9');
    assert.equal((await f.api('/api/config', owner.token)).superadminIP, '127.0.0.9');
    for (const ip of [null, '127.0.0.8']) await f.api('/api/accounts/' + me.id + '/ip-binding', owner.token, { method: 'PUT', body: { ip }, status: 409 });
    await f.api('/api/config', owner.token, { method: 'PUT', body: { superadminIP: '127.0.0.8' }, status: 400 });
    await f.api('/api/config', owner.token, { method: 'PUT', body: { jiyuPort: 5003 } });
    assert.equal(read(path.join(f.dir, 'config.json')).superadminIP, '127.0.0.9');
    await f.stop(); const file = path.join(f.dir, 'config.json'), config = read(file); config.superadminIP = '127.0.0.8'; fs.writeFileSync(file, JSON.stringify(config));
    await f.start(); await f.api('/api/me', owner.token, { sourceIp: '127.0.0.8', status: 401 }); await login(f, '127.0.0.9', 403);
    const next = await login(f, '127.0.0.8'); assert.equal((await f.api('/api/me', next.token)).id, me.id);
    await f.stop(); config.superadminIP = ''; fs.writeFileSync(file, JSON.stringify(config)); await f.start();
    await login(f, '127.0.0.9', 403); await login(f, '127.0.0.8');
});
test('conflicting or invalid pinned IP fails without overwriting users or claiming another device', { timeout: 30000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); await login(f);
    const alice = await f.api('/api/register', null, { method: 'POST', sourceIp: '127.0.0.3', body: { username: 'alice', password: 'alice-password' } });
    await f.stop(); const file = path.join(f.dir, 'config.json'), config = read(file), original = fs.readFileSync(path.join(f.dir, 'users.json'), 'utf8');
    for (const ip of ['127.0.0.3', 'not-an-ip', '192.168.999.1']) {
        config.superadminIP = ip; fs.writeFileSync(file, JSON.stringify(config)); expectStartupFailure(f, /superadminIP/);
        assert.equal(fs.readFileSync(path.join(f.dir, 'users.json'), 'utf8'), original);
    }
    config.superadminIP = ''; fs.writeFileSync(file, JSON.stringify(config)); await f.start(); await f.api('/api/me', alice.token);
});
