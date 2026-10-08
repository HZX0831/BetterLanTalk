const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const createNotifications = require('../../client/notifications');
const html = fs.readFileSync(path.join(__dirname, '../../client/chat.html'), 'utf8');

function browser(t, { secure = true, permission = 'granted', unsupported = false, requestError = false, constructorError = false } = {}) {
  const dom = new JSDOM(html, { url: secure ? 'https://chat.example/' : 'http://192.168.1.2:3001/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const state = { focused: false, hidden: false, room: 'default', viewingChat: true, notices: [], hints: [], requested: 0, opened: [] };
  Object.defineProperty(window, 'isSecureContext', { value: secure });
  Object.defineProperty(window.document, 'hidden', { get: () => state.hidden });
  window.document.hasFocus = () => state.focused;
  window.focus = () => { state.focused = true; };
  window.console.log = () => {};
  window.matchMedia = () => ({ matches: false });
  if (!unsupported) {
    window.Notification = class {
      static permission = permission;
      static async requestPermission() {
        state.requested++;
        if (requestError) throw new Error('Request failed');
        return this.permission = 'granted';
      }
      constructor(title, options) {
        if (constructorError) throw new Error('Desktop service unavailable');
        this.title = title; this.options = options; state.notices.push(this);
      }
      close() { this.closed = true; if (this.onclose) this.onclose(); }
    };
  }
  const ChatNotifications = createNotifications(window);
  window.ChatNotifications = ChatNotifications;
  const options = {
    currentUser: () => 'me', currentRoom: () => state.room, roomName: room => room === 'other' ? '其他房间' : '公共聊天室',
    isViewingChat: () => state.viewingChat,
    openRoom: room => { state.room = room; state.opened.push(room); notifications.markRead(); },
    onUnread: () => {}, onHint: text => state.hints.push(text)
  };
  const notifications = new ChatNotifications(options);
  return { window, state, notifications, options };
}
const message = (id, room = 'default', extra = {}) => ({ id, room, username: 'friend', type: 'text', content: 'hello', ...extra });

test('LAN HTTP enables unread reminders without trying forbidden system permission', async t => {
  const { window, state, notifications } = browser(t, { secure: false, permission: 'denied' });
  await notifications.toggle();
  assert.equal(state.requested, 0);
  assert.equal(notifications.enabled, true);
  assert.equal(window.document.getElementById('notify-btn').textContent, '未读提醒');
  assert.match(state.hints[0], /HTTPS/);
  assert.equal(window.localStorage.getItem('lantalk_notify'), 'on');
  notifications.receive(message('lan', 'other'));
  assert.equal(state.notices.length, 0);
  assert.equal(notifications.unread.get('other'), 1);
  assert.match(window.document.title, /^\(1\)/);
  await notifications.toggle();
  assert.equal(window.document.title, 'BetterLanTalk 内网聊天室');
  assert.equal(notifications.unread.get('other'), 1);
  await notifications.toggle();
  state.focused = true; state.room = 'other'; window.dispatchEvent(new window.Event('focus'));
  assert.equal(notifications.unread.size, 0);
  assert.equal(window.document.title, 'BetterLanTalk 内网聊天室');
});

test('native notifications cover an unfocused visible window and navigate to other rooms', async t => {
  const { window, state, notifications } = browser(t);
  await notifications.toggle();
  notifications.receive(message('native', 'other', { processedContent: '<p><strong>格式化</strong> 内容</p>' }));
  assert.equal(state.notices.length, 1);
  assert.equal(state.notices[0].title, 'friend · 其他房间');
  assert.equal(state.notices[0].options.body, '格式化 内容');
  notifications.receive(message('native', 'other'));
  assert.equal(state.notices.length, 1);
  assert.equal(notifications.unread.get('other'), 1);
  state.notices[0].onclick();
  assert.deepEqual(state.opened, ['other']);
  assert.equal(state.notices[0].closed, true);
  assert.equal(notifications.unread.size, 0);
  assert.equal(window.document.title, 'BetterLanTalk 内网聊天室');
});

test('active-room reading and own messages stay quiet; other rooms retain unread counts', async t => {
  const { window, state, notifications } = browser(t);
  await notifications.toggle(); state.focused = true;
  notifications.receive(message('reading'));
  notifications.receive(message('own', 'other', { username: 'me' }));
  assert.equal(notifications.unread.size, 0);
  notifications.receive(message('other', 'other'));
  assert.equal(notifications.unread.get('other'), 1);
  assert.equal(state.notices.length, 0);
  state.hidden = true;
  notifications.receive(message('hidden', 'default', { type: 'file', name: 'picture.png', isImage: true }));
  assert.equal(state.notices[0].options.body, '图片：picture.png');
  state.hidden = false; window.document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(notifications.unread.has('default'), false);
  assert.equal(notifications.unread.get('other'), 1);
  assert.equal(state.notices[0].closed, true);
  notifications.pruneRooms(['default']);
  assert.equal(notifications.unread.size, 0);
  assert.equal(window.document.title, 'BetterLanTalk 内网聊天室');
});

test('unsupported, denied and failed notification APIs preserve unread handling', async t => {
  for (const config of [{ unsupported: true }, { permission: 'denied' }, { permission: 'default', requestError: true }, { constructorError: true }]) {
    const { window, state, notifications } = browser(t, config);
    await notifications.toggle();
    assert.doesNotThrow(() => notifications.receive(message('fallback')));
    assert.equal(state.notices.length, 0);
    assert.equal(notifications.unread.get('default'), 1);
    assert.equal(window.document.getElementById('notify-btn').textContent, '未读提醒');
    await notifications.toggle();
    assert.equal(notifications.enabled, false);
    assert.equal(window.document.getElementById('notify-btn').getAttribute('aria-pressed'), 'false');
  }
});

test('permission is requested by a user action and preference updates across tabs', async t => {
  const { window, state, notifications } = browser(t, { permission: 'default' });
  assert.equal(state.requested, 0);
  await notifications.toggle();
  assert.equal(state.requested, 1);
  assert.equal(window.document.getElementById('notify-btn').textContent, '通知已开启');
  window.localStorage.setItem('lantalk_notify', 'off');
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'lantalk_notify' }));
  assert.equal(notifications.enabled, false);
  state.hidden = true; notifications.receive(message('off'));
  assert.equal(state.notices.length, 0);
});

test('several tabs for one account suppress duplicate system notifications', async t => {
  const first = browser(t), second = browser(t);
  Object.defineProperty(second.window, 'localStorage', { value: first.window.localStorage });
  await first.notifications.toggle();
  second.window.dispatchEvent(new second.window.StorageEvent('storage', { key: 'lantalk_notify' }));
  first.notifications.receive(message('shared'));
  second.notifications.receive(message('shared'));
  assert.equal(first.state.notices.length + second.state.notices.length, 1);
  assert.equal(first.notifications.unread.get('default'), 1);
  assert.equal(second.notifications.unread.get('default'), 1);
});

function chatApp(t) {
  const fixture = browser(t);
  const code = fs.readFileSync(path.join(__dirname, '../../client/chat.js'), 'utf8').split("document.addEventListener('DOMContentLoaded', async () => {")[0];
  fixture.window.eval(code.replace('class ChatApp', 'window.ChatApp = class ChatApp') + ';');
  const app = new fixture.window.ChatApp();
  const sent = [], listeners = new Map();
  app.socket = { emit: (event, data) => sent.push({ event, data }), on: (event, callback) => listeners.set(event, callback) };
  app.isConnected = true; app.currentUser = 'me';
  const input = fixture.window.document.getElementById('message-input'); input.disabled = false;
  return { ...fixture, app, input, sent, listeners };
}

test('editor reserves Enter for newlines and Ctrl/Command+Enter for sending, including IME', t => {
  const { window, app, input, sent } = chatApp(t);
  input.value = 'line one\nline two';
  const key = extra => {
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra });
    input.dispatchEvent(event); return event;
  };
  assert.equal(key({}).defaultPrevented, false);
  assert.equal(key({ shiftKey: true }).defaultPrevented, false);
  assert.equal(key({ ctrlKey: true, isComposing: true }).defaultPrevented, false);
  assert.equal(key({ ctrlKey: true, keyCode: 229 }).defaultPrevented, false);
  assert.equal(key({ ctrlKey: true, altKey: true }).defaultPrevented, false);
  assert.equal(sent.filter(packet => packet.event === 'send_message').length, 0);
  assert.equal(key({ ctrlKey: true }).defaultPrevented, true);
  assert.equal(sent.find(packet => packet.event === 'send_message').data.content, 'line one\nline two');
  assert.equal(input.value, '');
  input.value = 'macOS shortcut'; key({ metaKey: true });
  assert.equal(sent.filter(packet => packet.event === 'send_message').length, 2);
  window.clearTimeout(app.typingTimeout);
});

test('messages in another room reach notification handling without entering the active chat', async t => {
  const { window, app, listeners } = chatApp(t);
  const displayed = []; app.displayMessage = msg => displayed.push(msg);
  app.roomData = [{ id: 'default', name: '公共聊天室' }, { id: 'other', name: '其他房间' }];
  app.setupSocketListeners();
  await app.notifications.toggle();
  listeners.get('message')(message('different-room', 'other'));
  assert.equal(displayed.length, 0);
  assert.equal(app.notifications.unread.get('other'), 1);
  assert.match(window.document.title, /^\(1\)/);
  listeners.get('message')(message('same-room'));
  assert.equal(displayed.length, 1);
});
