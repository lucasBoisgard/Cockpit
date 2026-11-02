const test = require('node:test');
const assert = require('node:assert');
const { esc, linkify, escLink, md, inlineMd, renderList, richMd } = require('../web/js/markdown.js');

test('esc escapes html special characters', () => {
  assert.strictEqual(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(esc(null), '');
});

test('richMd renders headings and fills the table of contents', () => {
  const toc = [];
  const html = richMd('# Title\n\n## Part ##\n\n##### Deep', toc);
  assert.strictEqual(html, '<h1 id="reader-h-0">Title</h1><h2 id="reader-h-1">Part</h2><h4 id="reader-h-2">Deep</h4>');
  assert.deepStrictEqual(toc, [
    { id: 'reader-h-0', level: 1, text: 'Title' },
    { id: 'reader-h-1', level: 2, text: 'Part' },
    { id: 'reader-h-2', level: 4, text: 'Deep' },
  ]);
});

test('richMd renders nested lists with tasks', () => {
  const html = richMd('- x\n  - [x] done\n  - [ ] todo\n- y');
  assert.strictEqual(html, '<ul><li>x<ul><li class="todo-item"><input type="checkbox" disabled checked> done</li><li class="todo-item"><input type="checkbox" disabled > todo</li></ul></li><li>y</li></ul>');
});

test('renderList keeps the start of an ordered list', () => {
  assert.strictEqual(renderList([{ indent: 0, ordered: true, start: 3, text: 'a' }, { indent: 0, ordered: true, start: 4, text: 'b' }]), '<ol start="3"><li>a</li><li>b</li></ol>');
  assert.strictEqual(richMd('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});

test('richMd renders tables with alignment', () => {
  const html = richMd('| a | b | c |\n|:--|--:|:--:|\n| **1** | 2 | 3 |');
  assert.strictEqual(html, '<div class="table-wrap"><table><thead><tr><th>a</th><th style="text-align:right">b</th><th style="text-align:center">c</th></tr></thead><tbody><tr><td><b>1</b></td><td style="text-align:right">2</td><td style="text-align:center">3</td></tr></tbody></table></div>');
});

test('richMd escapes code blocks', () => {
  const html = richMd('```js\n<ok>\n```');
  assert.strictEqual(html, '<div class="code-block"><span class="lang">js</span><button class="copy-code" data-copy-code>Copier</button><pre><code>&lt;ok&gt;</code></pre></div>');
  assert.ok(!html.includes('<ok>'));
});

test('richMd renders blockquotes and rules', () => {
  assert.strictEqual(richMd('> quote\n> more\n\n---'), '<blockquote><p>quote<br>more</p></blockquote><hr>');
});

test('inlineMd renders bold, italic, strike and code', () => {
  assert.strictEqual(inlineMd('**b** *i* _u_ ~~s~~ `<c>`'), '<b>b</b> <i>i</i> <i>u</i> <s>s</s> <code>&lt;c&gt;</code>');
  assert.strictEqual(inlineMd('snake_case_name'), 'snake_case_name');
});

test('inlineMd only links http and https urls', () => {
  assert.strictEqual(inlineMd('[ok](https://a.b/c)'), '<a href="https://a.b/c" target="_blank" rel="noopener">ok</a>');
  const bad = inlineMd('[bad](javascript:alert(1))');
  assert.ok(!bad.includes('<a'));
  assert.ok(!bad.includes('href'));
  assert.strictEqual(inlineMd('<script>'), '&lt;script&gt;');
});

test('inlineMd escapes link targets', () => {
  assert.strictEqual(inlineMd('[x](https://e.com/"onx)'), '<a href="https://e.com/&quot;onx" target="_blank" rel="noopener">x</a>');
});

test('linkify cuts urls before escaped quotes and trailing punctuation', () => {
  assert.strictEqual(escLink('see "https://x.y/a" and https://x.y/b.'), 'see &quot;<a href="https://x.y/a" target="_blank" rel="noopener">https://x.y/a</a>&quot; and <a href="https://x.y/b" target="_blank" rel="noopener">https://x.y/b</a>.');
  assert.strictEqual(linkify(esc("'https://x.y/c'")), '&#39;<a href="https://x.y/c" target="_blank" rel="noopener">https://x.y/c</a>&#39;');
  assert.strictEqual(linkify('javascript:alert(1)'), 'javascript:alert(1)');
});

test('md renders the compact chat markdown', () => {
  assert.strictEqual(md('**b** `c`\n\n- a\n- b\n\n```\n<x>\n```'), '<p><b>b</b> <code>c</code></p><ul><li>a</li><li>b</li></ul><pre><code>&lt;x&gt;</code></pre>');
  assert.strictEqual(md('# Title\nline'), '<h4>Title</h4><p>line</p>');
});
