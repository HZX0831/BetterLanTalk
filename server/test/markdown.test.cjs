const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const render = require('../markdown');
const documentFor = text => new JSDOM(render(text)).window.document;

test('renders inline and display math with accessible MathML', () => {
    const doc = documentFor('$x^2$\n\n$$\\sum_{i=1}^{n} i$$');
    assert.equal(doc.querySelectorAll('.katex').length, 2);
    assert.equal(doc.querySelectorAll('math semantics annotation').length, 2);
    assert.ok(doc.querySelector('.luogu-math-display'));
});
test('renders nested foldable callouts and preserves open state', () => {
    const doc = documentFor('::::info[外层]{open}\n:::warning[内层]\n内容\n:::\n::::');
    assert.ok(doc.querySelector('details[open] details.luogu-callout-warning'));
    assert.equal(doc.querySelectorAll('summary').length, 2);
});
test('renders horizontal and vertical merged table cells', () => {
    const doc = documentFor('| A | B |\n| --- | --- |\n| x | < |\n| ^ | ^ |');
    const cell = doc.querySelector('tbody td');
    assert.equal(cell.colSpan, 2);
    assert.equal(cell.rowSpan, 2);
});
test('renders highlighted C++ blocks, line numbers and highlighted lines', () => {
    const doc = documentFor('```cpp line-numbers lines=2\nint main() {\n  return 0;\n}\n```');
    assert.equal(doc.querySelectorAll('.code-line-number').length, 3);
    assert.equal(doc.querySelectorAll('.code-line-highlighted').length, 1);
    assert.ok(doc.querySelector('.token.keyword'));
    assert.ok(doc.querySelector('.luogu-code-copy-btn'));
    assert.ok(!doc.querySelector('[onclick]'));
});
test('isolates footnote and heading anchors between chat messages', () => {
    const source = '# 标题\n\n文字[^1]\n\n[^1]: 注释';
    const doc = new JSDOM(render(source, 'one') + render(source, 'two')).window.document;
    const ids = Array.from(doc.querySelectorAll('[id]'), node => node.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const anchor of doc.querySelectorAll('a[href^="#"]')) assert.ok(doc.getElementById(anchor.hash.slice(1)));
});
test('supports alignment, epigraphs, links, lists and images', () => {
    const doc = documentFor(':::align{right}\n右侧\n:::\n\n:::epigraph[作者]\n引言\n:::\n\n- [x] 已完成\n\n![图片](/uploads/example.png)\n\n[链接](https://example.com)');
    assert.ok(doc.querySelector('.luogu-align-right'));
    assert.ok(doc.querySelector('.luogu-epigraph-author'));
    assert.ok(doc.querySelector('input[checked][disabled]'));
    assert.equal(doc.querySelector('img').getAttribute('src'), '/uploads/example.png');
    assert.equal(doc.querySelector('a').rel, 'noopener noreferrer');
});
test('Bilibili remains offline until explicitly loaded', () => {
    const doc = documentFor('![](bilibili:BV1xx411c7mD)');
    assert.equal(doc.querySelectorAll('iframe').length, 0);
    const button = doc.querySelector('.luogu-bilibili-facade');
    assert.ok(button.dataset.src.startsWith('https://player.bilibili.com/player.html?'));
    assert.ok(!button.hasAttribute('onclick'));
});
test('escapes raw HTML, rejects executable URLs and strips event handlers', () => {
    const doc = documentFor('<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n![x](data:text/html,evil)\n\n$\\href{javascript:alert(1)}{x}$');
    assert.ok(!doc.querySelector('script, iframe, [onerror], [onclick]'));
    for (const element of doc.querySelectorAll('[src], [href]')) {
        assert.ok(!/^(javascript|data|vbscript):/i.test(element.getAttribute('src') || element.getAttribute('href')));
    }
});
test('math macros do not leak between messages', () => {
    render('$\\gdef\\custom{abc}\\custom$', 'macro-definition');
    const doc = documentFor('$\\custom$');
    assert.ok(!doc.querySelector('.katex').textContent.includes('abc'));
});
test('malformed video parameters fall back to escaped text without crashing', () => {
    const doc = documentFor('![](bilibili:BV1xx411c7mD?t=%) <script>alert(1)</script>');
    assert.ok(doc.querySelector('.markdown-render-fallback'));
    assert.ok(!doc.querySelector('script'));
    assert.ok(doc.body.textContent.includes('<script>'));
});
