const fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { fixture } = require('./fixture.cjs');
const { sourceProxy } = require('./network.cjs');
const artifactDir = process.env.BROWSER_ARTIFACT_DIR || path.resolve(__dirname, '../../../BetterLanTalk-verification');
fs.mkdirSync(artifactDir, { recursive: true });
(async () => {
 const f = await fixture(), proxies = [], contexts = [], errors = []; let browser;
 try {
  const port = Number(new URL(f.base).port);
  const aProxy = await sourceProxy(port, '127.0.0.3'), adminProxy = await sourceProxy(port, '127.0.0.2'); proxies.push(aProxy, adminProxy);
  const admin = await f.api('/api/login', null, { method: 'POST', body: { username: 'admin', password: '=Aa1357924680' } });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', permissions: ['clipboard-read', 'clipboard-write'] }); contexts.push(context);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(aProxy.url); assert.equal(await page.locator('#messages-container').count(), 0);
  await page.click('#tab-register'); await page.fill('#username-input', 'alice'); await page.fill('#password-input', 'browser-password'); await page.fill('#password2-input', 'browser-password'); await page.click('#auth-button');
  await page.waitForFunction(() => window.chatApp?.isConnected && window.chatApp.currentMembers.length === 2);
  const token = await page.evaluate(() => window.chatApp.authToken);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('#markdown-toolbar button').count(), 3);
  assert.equal(await page.locator('[data-insert]').count(), 0);
  assert.equal(await page.locator('#send-button svg').count(), 1);
  await page.click('#preview-toggle'); await page.locator('.preview-pane').waitFor({ state: 'hidden' });
  await page.reload(); await page.waitForFunction(() => window.chatApp?.isConnected); await page.waitForFunction(() => document.querySelector('#composer-panes').classList.contains('no-preview'));
  await page.click('#preview-toggle'); await page.locator('.preview-pane').waitFor();
  const source = '# Luogu Markdown\n\n$x^2+y^2$\n\n:::info[说明]{open}\n左右编辑预览\n:::\n\n| A | B |\n| --- | --- |\n| 合并 | < |\n\n```cpp line-numbers lines=2\nint main() {\n return 0;\n}\n```';
  await page.fill('#message-input', source); await page.locator('#message-preview .katex').waitFor();
  assert.equal(await page.locator('#message-preview details[open]').count(), 1);
  assert.equal(await page.locator('#message-preview td[colspan="2"]').count(), 1);
  const shared = await page.evaluate(source => createChatMarkdown({ LuoguParser, katex, Prism, DOMPurify })(source, 'parity'), source);
  assert.equal(shared, require('../markdown')(source, 'parity'));
  await page.keyboard.press('Control+Enter'); await page.locator('.message-content .katex').waitFor();
  await page.fill('#message-input', 'first'); await page.press('#message-input', 'End'); await page.press('#message-input', 'Enter'); await page.keyboard.type('second'); assert.equal(await page.inputValue('#message-input'), 'first\nsecond');
  await page.locator('#message-input').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(await page.inputValue('#message-input'), 'first\nsecond'); await page.press('#message-input', 'Control+Enter'); await page.locator('.message-content:has-text("first")').waitFor();
  // Literal slash commands survive; known aliases insert local images.
  await page.fill('#message-input', '/jy'); await page.locator('#input-suggestions button').first().waitFor(); await page.press('#message-input', 'Enter');
  assert.equal(await page.inputValue('#message-input'), ':qq[0]: '); await page.locator('#message-preview .qq-emoji').waitFor();
  await page.fill('#message-input', '/not_a_real_command'); assert.equal(await page.locator('#input-suggestions').isVisible(), false);
  await page.fill('#message-input', '@adm'); await page.locator('#input-suggestions button').first().waitFor(); await page.press('#message-input', 'Enter');
  assert.equal(await page.inputValue('#message-input'), '@admin '); await page.locator('#message-preview .mention').waitFor();
  // Entity positions track edits before the mention.
  await page.press('#message-input', 'Home'); await page.keyboard.type('hi '); await page.press('#message-input', 'Control+Enter');
  await page.locator('.message-content .mention:has-text("@admin")').waitFor();
  assert.equal(await page.locator('#message-input').inputValue(), '');
  await page.fill('#message-input', '@全'); assert.equal(await page.locator('#input-suggestions').isVisible(), false); await page.fill('#message-input', '');
  console.log('PASS: light default, icon controls, saved preview, Luogu parity, Enter/IME, slash emoji and stable @ entities');
  // Genuine browser clipboard and native internal drag prevention.
  await page.evaluate(async () => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); });
  await page.focus('#message-input'); await page.keyboard.press('Control+V'); await page.locator('.msg-image img').waitFor();
  let uploads = 0; const trackUpload = request => { if (request.url().includes('/api/upload') && request.method() === 'POST') uploads++; }; page.on('request', trackUpload);
  const cancelled = await page.locator('.msg-image img').evaluate(image => { const event = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }); return !image.dispatchEvent(event); }); assert.equal(cancelled, true);
  await page.evaluate(async () => { const image = document.querySelector('.msg-image img'); const blob = await (await fetch(image.src)).blob(); const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'external.png', { type: 'image/png' })); document.querySelector('.messages-container').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })); });
  await page.waitForFunction(() => document.querySelectorAll('.msg-image img').length === 2); assert.equal(uploads, 1); page.off('request', trackUpload);
  await page.setInputFiles('#file-input', { name: 'verified.txt', mimeType: 'text/plain', buffer: Buffer.from('verified local upload') });
  await page.locator('.msg-file-card:has-text("verified.txt")').waitFor();
  const link = page.locator('.msg-file-card a.dl').last(); assert.equal(await (await context.request.get(await link.getAttribute('href'))).text(), 'verified local upload');
  // Reply/reaction context menu and group-only essence.
  const first = page.locator('.message.own').first(); await first.click({ button: 'right' }); await page.locator('#message-menu button:has-text("引用")').click(); assert.equal(await page.locator('#reply-strip').isVisible(), true);
  await page.fill('#message-input', 'a quoted reply'); await page.press('#message-input', 'Control+Enter'); await page.locator('.quoted-message').waitFor();
  await first.click({ button: 'right' }); await page.locator('#message-menu .quick-reactions button').first().click(); await page.locator('.reaction-chip').waitFor();
  console.log('PASS: Ctrl+V, external drop, no internal image resend, exact file download, quote and reactions');
  // Contacts have their own page; muted notifications retain gray unread counters and @ markers.
  await page.click('#group-settings-btn'); await page.locator('#dialog-body select').last().selectOption('none'); await page.locator('#dialog-body form').first().getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.chatApp.roomData.find(room => room.id === 'default')?.settings.notificationMode === 'none');
  await page.click('#nav-contacts'); assert.equal(await page.locator('#contacts-view').isVisible(), true); assert.equal(await page.locator('#chat-view').isVisible(), false);
  const alice = await f.api('/api/me', token); const request = (await f.api('/api/friend-requests', admin.token, { method: 'POST', body: { userId: alice.id } })).request;
  await page.locator('#friend-requests-btn').click(); await page.locator('#friend-requests button:has-text("接受")').click();
  await page.waitForFunction(() => window.chatApp.social.friends.length === 1);
  await page.locator('.contact-item:has-text("admin")').click(); await page.locator('#contact-profile [aria-label="发消息"]').click();
  await page.waitForFunction(() => window.chatApp.currentRoom.startsWith('dm-')); await page.click('#nav-contacts');
  await f.api('/api/rooms/default/messages', admin.token, { method: 'POST', body: { content: '@全体成员 check', mentions: [{ type: 'all', start: 0, end: 5 }] } });
  await page.click('#nav-chats'); await page.locator('[data-room-id="default"] .unread-badge.muted').waitFor(); await page.locator('[data-room-id="default"] .mention-indicator').waitFor();
  await page.locator('[data-room-id="default"]').click();
  // Browser group creation and settings, including persistent notification tiers.
  await page.click('#create-group-btn'); await page.getByLabel('群名称', { exact: true }).fill('浏览器群'); await page.locator('#dialog-body form').getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.chatApp.roomData.some(room => room.name === '浏览器群') && window.chatApp.currentRoom !== 'default');
  await page.click('#group-settings-btn'); await page.locator('#dialog-body select').first().selectOption('important'); await page.locator('#dialog-body form').first().getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.chatApp.roomData.find(room => room.id === window.chatApp.currentRoom)?.settings.notificationMode === 'important');
  await page.fill('#message-input', '@全'); await page.locator('#input-suggestions button').first().waitFor(); await page.press('#message-input', 'Enter'); assert.equal(await page.inputValue('#message-input'), '@全体成员 ');
  const groupId = await page.evaluate(() => window.chatApp.currentRoom);
  await f.api('/api/groups/' + groupId, token, { method: 'PUT', body: { announcement: '欢迎使用 BetterLanTalk。支持 Markdown、表情回应与 @ 提及。' } });
  await f.api('/api/groups/' + groupId + '/invitations', token, { method: 'POST', body: { userId: (await f.api('/api/me', admin.token)).id } });
  const invite = (await f.api('/api/group-invitations', admin.token)).find(item => item.roomId === groupId);
  await f.api('/api/groups/' + groupId + '/join', admin.token, { method: 'POST', body: { invitationId: invite.id } });
  const sample = (await f.api('/api/rooms/' + groupId + '/messages', token, { method: 'POST', body: { content: '支持 **Markdown**、$x^2$ 与本地表情 :qq[14]:。' } })).message;
  await f.api('/api/groups/' + groupId + '/messages/' + sample.id + '/essence', token, { method: 'PUT', body: { enabled: true } });
  await f.api('/api/rooms/' + groupId + '/messages', admin.token, { method: 'POST', body: { content: '已收到，公告和群聊功能都能正常显示。', replyToId: sample.id } });
  await page.locator('.message-content:has-text("已收到")').waitFor();
  await page.waitForFunction(() => document.querySelector('#upload-preview').classList.contains('hidden'));
  await page.fill('#message-input', source); await page.locator('#message-preview .katex').waitFor(); await page.screenshot({ path: path.join(artifactDir, 'chat-light-desktop.png') });
  // LAN HTTP clipboard fallback must focus inside an open modal, not its inert backdrop.
  const fallbackCopy = await page.evaluate(async () => {
    const clipboard = navigator.clipboard; window.chatApp.dialog('复制验证');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    try { await window.chatApp.copyText('modal clipboard fallback'); }
    finally { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard }); document.getElementById('app-dialog').close(); }
    return navigator.clipboard.readText();
  }); assert.equal(fallbackCopy, 'modal clipboard fallback');
  // Resizing and portrait half-screen fit.
  let handle = await page.locator('#composer-resize').boundingBox(), panes = await page.locator('#composer-panes').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y - 60, { steps: 8 }); await page.mouse.up();
  assert.ok((await page.locator('#composer-panes').boundingBox()).height > panes.height + 30);
  await page.setViewportSize({ width: 540, height: 960 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  for (const selector of ['#message-input', '#message-preview', '#send-button']) { const rect = await page.locator(selector).boundingBox(); assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 541 && rect.y + rect.height <= 960, selector + ' fits 9:16'); }
  await page.click('#details-toggle'); await page.locator('#chat-details.is-open').waitFor(); await page.click('#details-close'); assert.equal(await page.locator('#chat-details').isVisible(), false);
  await page.screenshot({ path: path.join(artifactDir, 'chat-light-9x16.png') });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.click('#nav-contacts'); await page.locator('.contact-item').first().click(); await page.screenshot({ path: path.join(artifactDir, 'contacts-light.png') });
  await page.click('#toolbox-btn'); await page.click('#theme-btn'); await page.getByLabel('外观', { exact: true }).selectOption('dark');
  await page.locator('#dialog-body form').getByRole('button', { name: '保存', exact: true }).click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.reload(); await page.waitForFunction(() => window.chatApp?.isConnected && document.documentElement.dataset.theme === 'dark');
  await page.fill('#message-input', source); await page.locator('#message-preview .katex').waitFor();
  assert.equal(await page.locator('.message.other').last().evaluate(element => getComputedStyle(element).backgroundColor), await page.locator('.composer').evaluate(element => getComputedStyle(element).backgroundColor));
  await page.screenshot({ path: path.join(artifactDir, 'chat-dark.png') });
  await page.evaluate(() => window.chatApp.saveAppearance({ theme: 'light' }));
  console.log('PASS: separate contacts, friend requests, gray muted @ unread, group creation, 3-tier settings, editor resize and 9:16 drawers');
  await context.grantPermissions(['notifications']); await page.click('#toolbox-btn'); await page.click('#notify-btn');
  await page.waitForFunction(() => document.getElementById('notify-btn').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.evaluate(() => { const notification = new Notification('API verification', { body: 'Browser notification check' }); notification.close(); return Notification.permission; }), 'granted');
  await page.click('#notify-btn'); assert.equal(await page.locator('#notify-btn').getAttribute('aria-pressed'), 'false');
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' }); contexts.push(adminContext); const adminPage = await adminContext.newPage(); adminPage.on('pageerror', error => errors.push(error.message));
  await adminPage.goto(adminProxy.url); await adminPage.fill('#username-input', 'admin'); await adminPage.fill('#password-input', '=Aa1357924680'); await adminPage.click('#auth-button'); await adminPage.waitForFunction(() => window.chatApp?.isConnected);
  await adminPage.goto(adminProxy.url + '/admin'); await adminPage.locator('#admin-accounts-list .admin-item:has-text("alice")').waitFor(); assert.equal(await adminPage.getByRole('button', { name: '解绑 IP', exact: true }).count(), 2);
  adminPage.once('dialog', dialog => dialog.accept('browserbot')); await adminPage.getByRole('button', { name: '创建 Bot', exact: true }).click(); await adminPage.locator('#admin-bots-list .admin-item:has-text("browserbot")').waitFor(); assert.match(await adminPage.locator('#bot-token').textContent(), /^blt_bot_/);
  assert.deepEqual(errors, []); console.log('PASS: separate admin panel, IP controls, Bot creation/token and no browser errors');
  console.log('Artifacts:', artifactDir);
 } finally { for (const context of contexts) await context.close(); await browser?.close(); for (const proxy of proxies) await proxy.close(); await f.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
