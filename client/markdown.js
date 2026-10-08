/* Shared Luogu renderer: the preview and server use the same parser and sanitizer. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.createChatMarkdown = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function ({ LuoguParser, katex, Prism, DOMPurify }) {
    return function renderMarkdown(source, namespace = 'preview') {
        const parser = new LuoguParser({ katex, prism: Prism });
        let html;
        try {
            html = parser.render(String(source));
        } catch {
            // Malformed extension syntax must not interrupt the preview or chat server.
            const escaped = String(source).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = '<p class="markdown-render-fallback">' + escaped + '</p>';
        }
        const fragment = DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true, svg: true, mathMl: true },
            ADD_TAGS: ['semantics', 'annotation'],
            ADD_ATTR: ['encoding'],
            RETURN_DOM_FRAGMENT: true,
            FORBID_TAGS: ['style', 'form', 'textarea', 'select'],
        });
        // Footnotes and headings belong to one message, even when texts are identical.
        const prefix = 'md-' + String(namespace).replace(/[^a-zA-Z0-9_-]/g, '-') + '-';
        const ids = new Map();
        fragment.querySelectorAll('[id]').forEach(el => {
            const old = el.id;
            el.id = prefix + old;
            ids.set(old, el.id);
        });
        fragment.querySelectorAll('a').forEach(el => {
            const href = el.getAttribute('href') || '';
            if (href.startsWith('#') && ids.has(href.slice(1))) el.setAttribute('href', '#' + ids.get(href.slice(1)));
            if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
        });
        // Received task lists are immutable; changing a checkbox must not edit a message.
        fragment.querySelectorAll('input').forEach(el => { el.disabled = true; });
        const holder = fragment.ownerDocument.createElement('div');
        holder.appendChild(fragment);
        return holder.innerHTML;
    };
});
