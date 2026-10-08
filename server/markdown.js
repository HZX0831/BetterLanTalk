const { JSDOM } = require('jsdom');
const DOMPurify = require('dompurify')(new JSDOM('').window);
const katex = require('katex');
const Prism = require('prismjs');
for (const language of ['c', 'cpp', 'python', 'bash', 'json', 'java', 'rust', 'go', 'pascal', 'latex']) {
    require('prismjs/components/prism-' + language);
}
const { LuoguParser } = require('../client/vendor/luogu-markdown-editor/luogu-parser');
module.exports = require('../client/markdown')({ LuoguParser, katex, Prism, DOMPurify });
