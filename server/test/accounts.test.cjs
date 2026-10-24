const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./fixture.cjs');
test('manual account edits remain untouched and become effective after restart', { timeout: 20000 }, async t => {
    const f = await fixture(); t.after(f.cleanup);
    const admin = await f.api('/api/login', null, { method: 'POST', body: { username: 'admin', password: '=Aa1357924680' } });
    const alice = await f.api('/api/register', null, { method: 'POST', body: { username: 'alice', password: 'alice-password' } });
    const file = path.join(f.dir, 'users.json'), accounts = JSON.parse(fs.readFileSync(file));
    accounts.users.find(account => account.username === 'alice').role = 'admin';
    const owner = accounts.users.find(account => account.username === 'admin');
    owner.passwordHash = crypto.scryptSync('file-changed-password', owner.salt, 64).toString('hex');
    const edited = JSON.stringify(accounts); fs.writeFileSync(file, edited);
    await new Promise(resolve => setTimeout(resolve, 2300)); assert.equal(fs.readFileSync(file, 'utf8'), edited);
    await f.api('/api/accounts', alice.token, { status: 403 });
    await f.stop(); await f.start(); await f.api('/api/accounts', alice.token);
    await f.api('/api/login', null, { method: 'POST', body: { username: 'admin', password: '=Aa1357924680' }, status: 401 });
    const logged = await f.api('/api/login', null, { method: 'POST', body: { username: 'admin', password: 'file-changed-password' } });
    assert.equal(logged.role, 'superadmin'); assert.equal((await f.api('/api/me', admin.token)).id, owner.id);
});
test('invalid or missing account JSON fails without creating replacement credentials', { timeout: 15000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); await f.stop();
    const file = path.join(f.dir, 'users.json');
    const rejected = () => {
        const result = spawnSync(process.execPath, ['server.js'], { cwd: f.dir, env: { ...process.env, LANTALK_DATA_DIR: f.dir, PORT: '0', LANTALK_OPEN_BROWSER: '0' }, timeout: 5000, encoding: 'utf8' });
        assert.equal(result.status, 1); assert.match(result.stderr, /users.json/);
    };
    for (const content of ['{broken', 'null']) { fs.writeFileSync(file, content); rejected(); assert.equal(fs.readFileSync(file, 'utf8'), content); }
    fs.unlinkSync(file); rejected(); assert.equal(fs.existsSync(file), false);
});
test('account format requires one superadmin but never promotes or silently changes roles', { timeout: 15000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); await f.stop();
    const file = path.join(f.dir, 'users.json'), accounts = JSON.parse(fs.readFileSync(file));
    for (const users of [[], accounts.users.map(account => ({ ...account, role: 'admin' })), [...accounts.users, { ...accounts.users[0], id: 'other', username: 'other' }]]) {
        const content = JSON.stringify({ users, tokens: {} }); fs.writeFileSync(file, content);
        const result = spawnSync(process.execPath, ['server.js'], { cwd: f.dir, env: { ...process.env, LANTALK_DATA_DIR: f.dir, PORT: '0', LANTALK_OPEN_BROWSER: '0' }, timeout: 5000, encoding: 'utf8' });
        assert.equal(result.status, 1); assert.match(result.stderr, /恰好包含一名超级管理员/); assert.equal(fs.readFileSync(file, 'utf8'), content);
    }
});
