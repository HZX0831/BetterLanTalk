# Luogu Markdown parser

Vendored without changes from [wudream813/luogu-markdown-editor](https://github.com/wudream813/luogu-markdown-editor), version **1.40.3**, commit `9e07275fbe440a568885cde6cfa50e29237c4c6e` (`src/luogu-parser.js`). The upstream MIT license is included here.

BetterLanTalk uses this parser on both the server and in the message composer. Chat-specific UI and sanitized interactions live outside the vendored file. Toolbar SVG and text icons in `client/index.html` are also copied from this upstream revision (its `index.html`), under the same MIT license. Chat omits the upstream spacing fixer, templates, export and workspace controls. KaTeX and Prism are pinned npm dependencies served locally. To update, replace the parser from a reviewed upstream version, update this record, and run the Markdown and chat tests.
