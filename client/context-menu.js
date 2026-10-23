'use strict';
// Bubble phase lets message/member handlers take precedence, including Shift+F10.
document.addEventListener('contextmenu', event => {
    if (event.defaultPrevented) return;
    document.getElementById('message-menu')?.classList.add('hidden');
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const input = target?.closest('input, textarea, [contenteditable]');
    const textTypes = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
    if (input && (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT' && textTypes.includes(input.type) || input.isContentEditable)) return;
    event.preventDefault();
});
