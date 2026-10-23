const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fixture, receive } = require('./fixture.cjs');
const policy = require('../../client/message-policy');
const password = 'community-password';

test('group roles, admission, message entities, personal settings, Bots and IP governance', { timeout: 40000 }, async t => {
    const f = await fixture(); t.after(f.cleanup); const { api } = f;
    const login = async username => {
        const data = await api('/api/login', null, { method: 'POST', body: { username, password: username === 'admin' ? '=Aa1357924680' : password } });
        return { ...data, ...(await api('/api/me', data.token)) };
    };
    const admin = await login('admin'), people = {};
    for (const username of ['alice', 'bob', 'charlie']) {
        const data = await api('/api/register', null, { method: 'POST', body: { username, password } });
        people[username] = { ...data, ...(await api('/api/me', data.token)) };
    }
    const { alice, bob, charlie } = people;
    const a = await f.connect(alice.token), b = await f.connect(bob.token);
    const friend = async (from, to) => {
        const { request } = await api('/api/friend-requests', from.token, { method: 'POST', body: { userId: to.id } });
        await api('/api/friend-requests/' + request.id, to.token, { method: 'PUT', body: { action: 'accept' } });
    };
    let group, privateGroup, bot, firstMessage;
    await t.test('all humans create groups, old mutation endpoints are disabled, global admins cannot read unjoined groups', async () => {
        await api('/api/rooms', alice.token, { method: 'POST', body: { roomId: 'bypass' }, status: 410 });
        const error = receive(a, 'error'); a.emit('create_room', { roomId: 'bypass' }); assert.match(await error, /停用/);
        group = (await api('/api/groups', alice.token, { method: 'POST', body: { name: '公开测试群', isPublic: true, joinMode: 'answer', questions: [{ question: '2+2?', answer: '4' }] } })).room;
        assert.equal(group.groupRole, 'owner'); assert.equal(group.canManage, true);
        await api('/api/groups', alice.token, { method: 'POST', body: { name: 'invalid', isPublic: true, questions: [null] }, status: 400 });
        const discovered = (await api('/api/groups', bob.token)).find(item => item.id === group.id);
        assert.deepEqual(discovered.questions, ['2+2?']); assert.ok(!JSON.stringify(discovered).includes('"answer":'));
        for (const token of [admin.token, bob.token]) await api('/api/rooms/' + group.id + '/messages', token, { status: 403 });
        await api('/api/groups/' + group.id + '/join', bob.token, { method: 'POST', body: { answers: ['wrong'] }, status: 400 });
        await api('/api/rooms/' + group.id + '/join', bob.token, { method: 'POST', status: 410 });
        await api('/api/groups/' + group.id + '/join', bob.token, { method: 'POST', body: { answers: [' 4 '] } });
        await api('/api/groups/' + group.id, bob.token, { method: 'PUT', body: { announcement: 'bypass' }, status: 403 });
    });
    await t.test('private invitations require friendship and approval; forwarded cards and old endpoints cannot grant access', async () => {
        await friend(alice, bob);
        privateGroup = (await api('/api/groups', alice.token, { method: 'POST', body: { name: '私有审核群', isPublic: false, joinMode: 'review', questions: [{ question: '为什么加入？' }] } })).room;
        assert.ok(!(await api('/api/groups', bob.token)).some(item => item.id === privateGroup.id));
        await api('/api/groups/' + privateGroup.id + '/invitations', alice.token, { method: 'POST', body: { userId: charlie.id }, status: 403 });
        const { invitation } = await api('/api/groups/' + privateGroup.id + '/invitations', alice.token, { method: 'POST', body: { userId: bob.id } });
        await api('/api/groups/' + privateGroup.id + '/join', charlie.token, { method: 'POST', body: { invitationId: invitation.id, answers: ['forward'] }, status: 403 });
        const response = await api('/api/groups/' + privateGroup.id + '/join', bob.token, { method: 'POST', body: { invitationId: invitation.id, answers: ['test'] } });
        assert.equal(response.pending, true); await api('/api/rooms/' + privateGroup.id + '/messages', bob.token, { status: 403 });
        const duplicate = await api('/api/groups/' + privateGroup.id + '/join', bob.token, { method: 'POST', body: { invitationId: invitation.id, answers: ['test'] } });
        assert.equal(duplicate.application.id, response.application.id);
        await api('/api/groups/' + privateGroup.id + '/applications/' + response.application.id, alice.token, { method: 'PUT', body: { action: 'accept' } });
        await api('/api/rooms/' + privateGroup.id + '/messages', bob.token);
        await friend(bob, charlie);
        const another = await api('/api/groups/' + privateGroup.id + '/invitations', bob.token, { method: 'POST', body: { userId: charlie.id } });
        assert.ok(another.invitation, 'ordinary members can invite their friends');
        const pending = await api('/api/groups/' + privateGroup.id + '/join', charlie.token, { method: 'POST', body: { invitationId: another.invitation.id, answers: ['temporary friendship'] } });
        await api('/api/friends/' + charlie.id, bob.token, { method: 'DELETE' });
        await api('/api/groups/' + privateGroup.id + '/applications/' + pending.application.id, alice.token, { method: 'PUT', body: { action: 'accept' }, status: 403 });
        await api('/api/groups/' + privateGroup.id + '/applications/' + pending.application.id, alice.token, { method: 'PUT', body: { action: 'reject' } });
    });
    await t.test('mentions use stable IDs and visible ranges; all-member mentions require group role', async () => {
        const content = '@bob hello'; const mentions = [{ type: 'user', userId: bob.id, start: 0, end: 4 }];
        firstMessage = (await api('/api/rooms/' + group.id + '/messages', alice.token, { method: 'POST', body: { content, mentions } })).message;
        assert.match(firstMessage.processedContent, /data-mention-id=/); assert.match(firstMessage.processedContent, /@bob/);
        assert.equal(firstMessage.senderRole, 'owner');
        const all = { content: '@全体成员 hello', mentions: [{ type: 'all', start: 0, end: 5 }] };
        await api('/api/rooms/' + group.id + '/messages', bob.token, { method: 'POST', body: all, status: 403 });
        await api('/api/rooms/' + group.id + '/messages', alice.token, { method: 'POST', body: all });
        await api('/api/rooms/' + group.id + '/messages', alice.token, { method: 'POST', body: { content: '`@bob`', mentions: [{ ...mentions[0], start: 1, end: 5 }] }, status: 400 });
        await api('/api/rooms/' + group.id + '/messages', alice.token, { method: 'POST', body: { content: 'hidden', mentions }, status: 400 });
        await api('/api/rooms/' + group.id + '/messages', alice.token, { method: 'POST', body: { content: '@charlie', mentions: [{ type: 'user', userId: charlie.id, start: 0, end: 8 }] }, status: 400 });
    });
    await t.test('quotes, reactions, essence, search and private clear maintain authorization and isolation', async () => {
        const quoted = (await api('/api/rooms/' + group.id + '/messages', bob.token, { method: 'POST', body: { content: '**reply** :qq[14]:', replyToId: firstMessage.id } })).message;
        assert.equal(quoted.quote.id, firstMessage.id); assert.match(quoted.processedContent, /qq-emoji/);
        await api('/api/rooms/default/messages', bob.token, { method: 'POST', body: { content: 'cross-room', replyToId: firstMessage.id }, status: 400 });
        const url = '/api/rooms/' + group.id + '/messages/' + firstMessage.id + '/reactions';
        assert.equal((await api(url, bob.token, { method: 'PUT', body: { emojiId: '14' } })).message.reactions[0].userIds.length, 1);
        assert.equal((await api(url, bob.token, { method: 'PUT', body: { emojiId: '14' } })).message.reactions.length, 0);
        const essence = '/api/groups/' + group.id + '/messages/' + firstMessage.id + '/essence';
        await api(essence, bob.token, { method: 'PUT', body: { enabled: true }, status: 403 });
        await api(essence, alice.token, { method: 'PUT', body: { enabled: true } });
        assert.equal((await api('/api/groups/' + group.id + '/essence', bob.token)).length, 1);
        assert.equal((await api('/api/rooms/' + group.id + '/search?q=reply&userId=' + bob.id, alice.token)).length, 1);
        await api('/api/rooms/' + group.id + '/settings', bob.token, { method: 'PUT', body: { clear: true, notificationMode: 'none', pinned: true, nickname: 'B', remark: '我的群' } });
        assert.deepEqual(await api('/api/rooms/' + group.id + '/messages', bob.token), []);
        assert.ok((await api('/api/rooms/' + group.id + '/messages', alice.token)).length > 0);
        assert.equal((await api('/api/groups/' + group.id + '/essence', bob.token)).length, 1);
        await api('/api/rooms/' + group.id + '/messages/' + firstMessage.id + '/context', bob.token, { status: 404 });
    });
    await t.test('Bot credentials, automatic friend requests and updates persist, and group administration uses the same roles', async () => {
        const result = await api('/api/bots', admin.token, { method: 'POST', body: { username: 'helperbot', about: 'helper' } }); bot = { ...result.bot, token: result.token };
        assert.equal((await api('/api/bot/v1/me', bot.token)).kind, 'bot');
        await api('/api/me', bot.token, { status: 401 }); await api('/client/chat.js', bot.token, { status: 401 });
        await api('/api/login', null, { method: 'POST', body: { username: bot.username, password }, status: 401 });
        const requests = (await api('/api/social', alice.token)).requests.filter(item => item.from === bot.id); assert.equal(requests.length, 1);
        await api('/api/friend-requests/' + requests[0].id, alice.token, { method: 'PUT', body: { action: 'accept' } });
        await api('/api/groups/' + group.id + '/invitations', alice.token, { method: 'POST', body: { userId: bot.id } });
        const invite = (await api('/api/bot/v1/invitations', bot.token))[0];
        await api('/api/bot/v1/groups/' + group.id + '/join', bot.token, { method: 'POST', body: { invitationId: invite.id, answers: ['4'] } });
        await api('/api/groups/' + group.id + '/members/' + bot.id + '/role', alice.token, { method: 'PUT', body: { role: 'admin' } });
        await api('/api/bot/v1/groups/' + group.id, bot.token, { method: 'PUT', body: { announcement: 'Bot 公告' } });
        await api('/api/bot/v1/groups/' + group.id + '/owner', bot.token, { method: 'PUT', body: { userId: bob.id }, status: 403 });
        await api('/api/groups/' + group.id + '/owner', alice.token, { method: 'PUT', body: { userId: bot.id }, status: 400 });
        await api('/api/users/helperbot/role', admin.token, { method: 'PUT', body: { role: 'admin' }, status: 403 });
        const message = (await api('/api/rooms/' + group.id + '/messages', bob.token, { method: 'POST', body: { content: 'all group messages to bot' } })).message;
        const updates = await api('/api/bot/v1/updates', bot.token); assert.ok(updates.updates.some(item => item.data.id === message.id));
        const reply = (await api('/api/bot/v1/rooms/' + group.id + '/messages', bot.token, { method: 'POST', body: { content: '@全体成员 bot', mentions: [{ type: 'all', start: 0, end: 5 }], replyToId: message.id } })).message;
        assert.equal(reply.senderKind, 'bot'); assert.equal(reply.senderRole, 'admin');
        assert.ok(!(await api('/api/bot/v1/updates', bot.token)).updates.some(item => item.type === 'message' && item.data.id === reply.id));
        const store = fs.readFileSync(path.join(f.dir, 'users.json'), 'utf8'); assert.ok(!store.includes(bot.token));
        const changed = await api('/api/bots/' + bot.id + '/token', admin.token, { method: 'POST' });
        await api('/api/bot/v1/me', bot.token, { status: 401 }); bot.token = changed.token;
        await api('/api/bots/' + bot.id, admin.token, { method: 'PUT', body: { disabled: true } }); await api('/api/bot/v1/me', bot.token, { status: 401 });
        await api('/api/bots/' + bot.id, admin.token, { method: 'PUT', body: { disabled: false } });
        assert.equal((await api('/api/social', alice.token)).requests.filter(item => item.from === bot.id).length, 0);
    });
    await t.test('native image decoding persists avatars separately from chat uploads and rejects SVG', async () => {
        const { PNG } = require('pngjs'); const image = new PNG({ width: 2, height: 3 }); image.data.fill(200); const buffer = PNG.sync.write(image);
        const { request } = require('./network.cjs');
        const response = await request(f.base + '/api/me/avatar', { method: 'PUT', localAddress: alice.boundIp, headers: { authorization: 'Bearer ' + alice.token, 'content-type': 'application/octet-stream' }, body: buffer });
        assert.equal(response.status, 200); const data = await response.json();
        const stored = PNG.sync.read(fs.readFileSync(path.join(f.dir, 'avatars', path.basename(data.avatar)))); assert.equal(stored.width, 256); assert.equal(stored.height, 256);
        await api('/api/me/avatar', alice.token, { method: 'PUT', body: '<svg/>', headers: { 'content-type': 'application/octet-stream' }, status: 400 });
    });
    await t.test('IP governance rejects conflicts and unauthorized changes, and unbinding invalidates active sockets', async () => {
        await api('/api/accounts/' + alice.id + '/ip-binding', bob.token, { method: 'PUT', body: { ip: null }, status: 403 });
        await api('/api/accounts/' + alice.id + '/ip-binding', admin.token, { method: 'PUT', body: { ip: bob.boundIp }, status: 409 });
        const disconnected = receive(a, 'disconnect'); await api('/api/accounts/' + alice.id + '/ip-binding', admin.token, { method: 'PUT', body: { ip: null } }); await disconnected;
        await api('/api/me', alice.token, { status: 401 });
        const rebound = await api('/api/login', null, { method: 'POST', sourceIp: '127.0.0.50', body: { username: 'alice', password } }); alice.token = rebound.token;
        assert.equal((await api('/api/me', alice.token)).boundIp, '127.0.0.50');
        await api('/api/accounts/' + bot.id + '/ip-binding', admin.token, { method: 'PUT', body: { ip: null }, status: 400 });
        assert.equal((await api('/api/accounts/audit/ip-binding', admin.token)).length, 1);
        await api('/api/users/alice', admin.token, { method: 'DELETE', status: 409 });
    });
    await t.test('preferences, role data, Bot queue and identity survive restart; removal revokes history', async () => {
        await api('/api/preferences', bob.token, { method: 'PUT', body: { sendMode: 'invalid' }, status: 400 });
        await api('/api/preferences', bob.token, { method: 'PUT', body: { theme: 'dark', accent: '#20a278', preview: false, sendMode: 'enter' } });
        await f.stop(); await f.start();
        assert.deepEqual(await api('/api/preferences', bob.token), { theme: 'dark', accent: '#20a278', preview: false, sendMode: 'enter' });
        assert.equal((await api('/api/groups/' + group.id, alice.token)).announcement, 'Bot 公告');
        assert.equal((await api('/api/rooms', bob.token)).find(item => item.id === group.id).settings.notificationMode, 'none');
        assert.ok((await api('/api/bot/v1/updates', bot.token)).updates.length > 0);
        await api('/api/groups/' + group.id + '/members/' + bob.id, alice.token, { method: 'DELETE' });
        await api('/api/rooms/' + group.id + '/messages', bob.token, { status: 403 });
        await api('/api/groups/' + group.id, admin.token, { method: 'DELETE' });
        assert.ok(!(await api('/api/rooms', alice.token)).some(item => item.id === group.id));
    });
});

test('the shared notification matrix includes role messages and only mentions addressed to the recipient', () => {
    const base = { userId: 'sender', senderRole: 'member', mentions: [] };
    for (const mode of policy.modes) assert.equal(policy.eligible(mode, { ...base, userId: 'me' }, 'me'), false);
    for (const variant of [base, { ...base, senderRole: 'owner' }, { ...base, senderRole: 'admin' }, { ...base, mentions: [{ type: 'all' }] }, { ...base, mentions: [{ type: 'user', userId: 'me' }] }]) {
        assert.equal(policy.eligible('none', variant, 'me'), false); assert.equal(policy.eligible('all', variant, 'me'), true);
    }
    assert.equal(policy.eligible('important', base, 'me'), false);
    assert.equal(policy.eligible('important', { ...base, mentions: [{ type: 'user', userId: 'someone' }] }, 'me'), false);
    for (const senderRole of ['owner', 'admin']) assert.equal(policy.eligible('important', { ...base, senderRole }, 'me'), true);
    for (const mentions of [[{ type: 'all' }], [{ type: 'user', userId: 'me' }]]) assert.equal(policy.eligible('important', { ...base, mentions }, 'me'), true);
});
