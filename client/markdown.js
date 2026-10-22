/* Shared Luogu renderer: the preview and server use the same parser and sanitizer. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.createChatMarkdown = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function ({ LuoguParser, katex, Prism, DOMPurify, emojiIds, isPlainMention = () => true }) {
    return function renderMarkdown(source, namespace = 'preview', mentions = []) {
        const parser = new LuoguParser({ katex, prism: Prism });
        let html;
        const mentionTokens = new Map();
        try {
            let input = String(source);
            for (const item of [...mentions].sort((a,b) => b.start - a.start)) {
                if (!Number.isInteger(item.start) || !Number.isInteger(item.end) || input.slice(item.start, item.end) !== '@' + item.label || !isPlainMention(String(source), item.start, item.end)) continue;
                const token = 'BLTM' + String(namespace).replace(/[^a-z0-9]/gi, '').toLowerCase() + mentionTokens.size + 'END';
                mentionTokens.set(token, item);
                input = input.slice(0, item.start) + token + input.slice(item.end);
            }
            html = parser.render(input);
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
        // Replace only plain text nodes, after sanitization. Code/math/links stay literal.
        const doc = fragment.ownerDocument;
        const walker = doc.createTreeWalker(fragment, 4);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            if (node.parentElement?.closest('pre, code, a, .katex, math, .luogu-math-inline, .luogu-math-display')) continue;
            const pattern = /BLTM[a-z0-9]+END|:qq\[(\d+)\]:/g;
            let match, last = 0;
            const replacement = doc.createDocumentFragment();
            while ((match = pattern.exec(node.nodeValue))) {
                const entry = mentionTokens.get(match[0]);
                const knownEmoji = match[1] && (!emojiIds || emojiIds.has(match[1]));
                if (!entry && !knownEmoji) continue;
                replacement.append(doc.createTextNode(node.nodeValue.slice(last, match.index)));
                if (entry) {
                    const span = doc.createElement('span'); span.className = 'mention';
                    span.dataset.mentionId = entry.type === 'all' ? 'all' : entry.userId;
                    span.dataset.mentionStart = entry.start; span.textContent = '@' + entry.label; replacement.append(span);
                } else {
                    const img = doc.createElement('img'); img.className = 'qq-emoji'; img.src = '/assets/qq/' + match[1] + '.png';
                    img.alt = ':qq[' + match[1] + ']:'; img.draggable = false; replacement.append(img);
                }
                last = match.index + match[0].length;
            }
            if (last) { replacement.append(doc.createTextNode(node.nodeValue.slice(last))); node.replaceWith(replacement); }
        }
        const holder = fragment.ownerDocument.createElement('div');
        holder.appendChild(fragment);
        return holder.innerHTML;
    };
});
