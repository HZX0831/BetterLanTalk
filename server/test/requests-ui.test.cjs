const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
test('request badges count incoming actionable items, cap at 99+ and survive opening the request page', t => {
    const client = path.join(__dirname, '../../client');
    const dom = new JSDOM(fs.readFileSync(path.join(client, 'chat.html'), 'utf8'), { runScripts: 'outside-only' }); t.after(() => dom.window.close());
    const { window } = dom; window.ChatApp = function () {};
    window.eval(fs.readFileSync(path.join(client, 'community-ui.js'), 'utf8'));
    const app = Object.create(window.ChatApp.prototype); Object.assign(app, { currentUserId: 'me', activeView: 'chats', social: { requests: [] }, invitations: [] });
    const badge = id => window.document.getElementById(id);
    app.social.requests = [{ from: 'me', to: 'other' }]; app.invitations = [{ applicationStatus: 'pending' }]; app.renderInvitations();
    assert.equal(badge('contacts-request-count').classList.contains('hidden'), true);
    app.social.requests.push({ from: 'other', to: 'me' }); app.invitations.push({ applicationStatus: null }); app.renderInvitations();
    assert.equal(badge('contacts-request-count').textContent, '2'); assert.equal(badge('friend-request-count').textContent, '1'); assert.equal(badge('invitation-count').textContent, '1');
    app.social.requests = Array.from({ length: 105 }, () => ({ to: 'me' })); app.renderInvitations();
    assert.equal(badge('friend-request-count').textContent, '99+'); assert.equal(badge('contacts-request-count').textContent, '99+');
    // Rendering an open page does not mark incoming requests as processed.
    app.activeView = 'contacts'; app.requestsView = 'friends'; app.makeActionRow = () => window.document.createElement('div'); app.renderInvitations();
    assert.equal(badge('contacts-request-count').textContent, '99+');
});
