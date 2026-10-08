(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', () => {
        const input = document.getElementById('message-input');
        const preview = document.getElementById('message-preview');
        const gutter = document.getElementById('line-numbers');
        const toolbar = document.getElementById('markdown-toolbar');
        const render = createChatMarkdown({ LuoguParser, katex, Prism, DOMPurify });
        let timer;
        let syncingScroll = false;
        let replayingHistory = false;
        let history = [{ value: input.value, start: 0, end: 0 }];
        let historyIndex = 0;
        const selection = () => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd });
        const rememberSelection = () => {
            if (history[historyIndex].value === input.value) history[historyIndex] = selection();
        };
        ['select', 'keyup', 'click'].forEach(name => input.addEventListener(name, rememberSelection));
        const updateLines = () => {
            gutter.innerHTML = Array.from({ length: input.value.split('\n').length }, (_, i) => '<div>' + (i + 1) + '</div>').join('');
            gutter.scrollTop = input.scrollTop;
        };
        const refresh = () => {
            preview.innerHTML = input.value.trim() ? render(input.value) : '<p class="preview-empty">输入内容后，在这里预览。</p>';
        };
        input.addEventListener('input', () => {
            if (!replayingHistory && history[historyIndex].value !== input.value) {
                history = history.slice(0, historyIndex + 1);
                history.push(selection());
                if (history.length > 100) history.shift();
                historyIndex = history.length - 1;
            }
            updateLines();
            clearTimeout(timer);
            timer = setTimeout(refresh, 120);
        });
        input.addEventListener('message-sent', () => {
            history = [selection()];
            historyIndex = 0;
            preview.scrollTop = 0;
            input.scrollTop = 0;
            updateLines();
            clearTimeout(timer);
            refresh();
        });
        // Both panes keep their own scrollbars. Match their relative scroll position.
        const syncScroll = (from, to) => {
            if (syncingScroll) return;
            syncingScroll = true;
            const range = from.scrollHeight - from.clientHeight;
            to.scrollTop = range > 0 ? from.scrollTop / range * (to.scrollHeight - to.clientHeight) : 0;
            gutter.scrollTop = input.scrollTop;
            requestAnimationFrame(() => { syncingScroll = false; });
        };
        input.addEventListener('scroll', () => {
            gutter.scrollTop = input.scrollTop;
            syncScroll(input, preview);
        });
        preview.addEventListener('scroll', () => syncScroll(preview, input));
        const snippets = {
                heading: ['# ', '', '标题'],
                bold: ['**', '**', '粗体'],
                italic: ['*', '*', '斜体'],
                strike: ['~~', '~~', '删除线'],
                'inline-code': ['`', '`', '代码'],
                math: ['$', '$', 'x^2 + y^2 = z^2'],
                'math-block': ['$$\n', '\n$$', '\\sum_{i=1}^n i = \\frac{n(n+1)}{2}'],
                code: ['```cpp\n', '\n```', 'int main() {\n    return 0;\n}'],
                table: ['', '', '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |'],
                callout: [':::info[提示]{open}\n', '\n:::', '内容'],
                epigraph: [':::epigraph[作者]\n', '\n:::', '引言'],
                align: [':::align{center}\n', '\n:::', '居中内容'],
                quote: ['> ', '', '引用内容'],
                link: ['[', '](https://example.com)', '链接文字'],
                image: ['![', '](https://example.com/image.png)', '图片描述'],
                'unordered-list': ['- ', '', '列表项'],
                'ordered-list': ['1. ', '', '列表项'],
                task: ['- [ ] ', '', '待办事项'],
                hr: ['', '', '---'],
            };
        const blockActions = new Set(['heading', 'quote', 'code', 'math-block', 'table', 'callout', 'epigraph', 'align', 'unordered-list', 'ordered-list', 'task', 'hr']);
        const edit = action => {
            if (input.disabled) return;
            rememberSelection();
            if (action === 'undo' || action === 'redo') {
                const next = historyIndex + (action === 'undo' ? -1 : 1);
                if (next < 0 || next >= history.length) return;
                historyIndex = next;
                const state = history[next];
                input.value = state.value;
                input.setSelectionRange(state.start, state.end);
                replayingHistory = true;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                replayingHistory = false;
                input.focus();
                return;
            }
            if (!snippets[action]) return;
            const [before, after, placeholder] = snippets[action];
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const selected = input.value.slice(start, end) || placeholder;
            const block = blockActions.has(action);
            const leading = block && start > 0 && input.value[start - 1] !== '\n' ? '\n\n' : '';
            const trailing = block && end < input.value.length && input.value[end] !== '\n' ? '\n\n' : '';
            const text = leading + before + selected + after + trailing;
            if (input.value.length - (end - start) + text.length > input.maxLength) return;
            input.setRangeText(text, start, end, 'select');
            input.setSelectionRange(start + leading.length + before.length, start + leading.length + before.length + selected.length);
            input.focus();
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        toolbar.addEventListener('click', e => {
            const button = e.target.closest('[data-insert]');
            if (button) edit(button.dataset.insert);
        });
        input.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
            const key = e.key.toLowerCase();
            const action = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' ? 'redo' : key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'm' ? (e.shiftKey ? 'math-block' : 'math') : null;
            if (action) { e.preventDefault(); edit(action); }
        });
        // Restore safe interactions after sanitizing upstream inline event handlers.
        document.addEventListener('click', async e => {
            const copy = e.target.closest('.luogu-code-copy-btn');
            if (copy) {
                const text = Array.from(copy.closest('.luogu-code-block-wrapper').querySelectorAll('.code-line-text')).map(line => line.textContent).join('\n');
                try {
                    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
                    else {
                        const field = document.createElement('textarea');
                        field.value = text;
                        field.style.position = 'fixed';
                        field.style.opacity = '0';
                        document.body.appendChild(field);
                        field.select();
                        const copied = document.execCommand('copy');
                        field.remove();
                        if (!copied) throw new Error('copy failed');
                    }
                    copy.querySelector('.copy-text').textContent = '已复制';
                    setTimeout(() => { copy.querySelector('.copy-text').textContent = '复制'; }, 1500);
                } catch { window.chatApp.showToast('复制失败，请手动选择代码复制'); }
            }
            const video = e.target.closest('.luogu-bilibili-facade');
            if (video) {
                const url = new URL(video.dataset.src);
                if (url.origin !== 'https://player.bilibili.com' || url.pathname !== '/player.html') return;
                const frame = document.createElement('iframe');
                frame.src = url.href;
                frame.title = video.getAttribute('aria-label');
                frame.allowFullscreen = true;
                frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
                frame.referrerPolicy = 'no-referrer';
                video.replaceWith(frame);
            }
        });
        updateLines();
        refresh();
    });
})();
