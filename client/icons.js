'use strict';
window.ChatIcons = (() => {
    const paths = {
        chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 1-6a8 8 0 1 1 18-5Z"/>',
        people: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8m2 3a6 6 0 0 1 3 6"/>',
        search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
        plus: '<path d="M12 4v16M4 12h16"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
        menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
        settings: '<path d="m9 3-1 3-3 1-2 4 2 3v4l4 2 3-1 3 1 4-2v-4l2-3-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
        star: '<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/>',
        folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h8a2 2 0 0 1 2 2v10H3Z"/>',
        attach: '<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2"/>',
        smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01"/>',
        preview: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/>',
        send: '<path d="m3 3 19 9-19 9 3-9-3-9Zm3 9h16"/>',
        keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M6 13h.01M10 13h.01M6 16h8m4-7v4h-4m2-2-2 2 2 2"/>',
        invite: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-2a7 7 0 0 1 12-5m4-3v8m-4-4h8"/>',
        requests: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
        history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-4v6l4 2"/>',
        crown: '<path d="m2 6 5 4 5-7 5 7 5-4-3 14H5Z"/>',
        shield: '<path d="m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
        bot: '<rect x="4" y="7" width="16" height="14" rx="4"/><path d="M12 7V3m-3 10h.01M15 13h.01M9 17h6M1 12v5m22-5v5"/>',
        pin: '<path d="m8 3 8 0-1 7 4 5H5l4-5-1-7Zm4 12v7"/>',
        mute: '<path d="m3 3 18 18M9 5l3-3 4 4v5m-4 1v10l-6-5H2V7h4m12 1a8 8 0 0 1 3 8"/>',
        copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
        quote: '<path d="M10 5H3v8h5c0 4-5 6-5 6m18-14h-7v8h5c0 4-5 6-5 6"/>',
        download: '<path d="M12 2v13m-5-5 5 5 5-5M3 16v6h18v-6"/>',
    };
    function svg(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.chat) + '</svg>'; }
    function paint(root = document) {
        root.querySelectorAll('[data-icon]').forEach(button => {
            if (!button.querySelector('svg')) button.insertAdjacentHTML('afterbegin', svg(button.dataset.icon));
            if (button.dataset.label) { button.title = button.dataset.label; button.setAttribute('aria-label', button.dataset.label); }
        });
    }
    return { svg, paint };
})();
document.addEventListener('DOMContentLoaded', () => ChatIcons.paint());
