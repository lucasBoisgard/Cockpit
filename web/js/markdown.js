const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function linkify(html) {
  return html.replace(/https?:\/\/[^\s<>"'`*]+/g, (raw) => {
    const cut = raw.search(/&(quot|#39|lt|gt);/);
    const url = (cut >= 0 ? raw.slice(0, cut) : raw).replace(/[.,;:!?)\]]+$/, '');
    return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${raw.slice(url.length)}`;
  });
}

const escLink = (s) => linkify(esc(s));

function md(text) {
  const inline = (s) => escLink(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return text.split(/```[^\n]*\n?/).map((part, i) => {
    if (i % 2) return `<pre><code>${escLink(part.replace(/\n$/, ''))}</code></pre>`;
    return part.split(/\n{2,}/).map((block) => {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) return '';
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''))}</li>`).join('')}</ul>`;
      if (/^#{1,6}\s/.test(lines[0])) return `<h4>${inline(lines[0].replace(/^#+\s/, ''))}</h4>${lines.length > 1 ? `<p>${lines.slice(1).map(inline).join('<br>')}</p>` : ''}`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }).join('');
}

function inlineMd(text) {
  return String(text).split(/(`[^`\n]+`)/).map((part) => {
    if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
    const links = [];
    const marked = part.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => `\u0000${links.push([label, url]) - 1}\u0000`);
    return escLink(marked)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<i>$2</i>')
      .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\u0000(\d+)\u0000/g, (m, n) => `<a href="${esc(links[n][1])}" target="_blank" rel="noopener">${esc(links[n][0])}</a>`);
  }).join('');
}

function renderList(items) {
  let html = '';
  const stack = [];
  for (const item of items) {
    while (stack.length && item.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || item.indent > top.indent) {
      const tag = item.ordered ? 'ol' : 'ul';
      stack.push({ indent: item.indent, tag });
      html += `<${tag}${item.ordered && item.start > 1 ? ` start="${item.start}"` : ''}>`;
    } else html += '</li>';
    const task = item.text.match(/^\[([ xX])\]\s+(.*)$/);
    html += task ? `<li class="todo-item"><input type="checkbox" disabled ${task[1] === ' ' ? '' : 'checked'}> ${inlineMd(task[2])}` : `<li>${inlineMd(item.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

function richMd(text, toc = []) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const isSep = (l) => l.includes('-') && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const isTable = (k) => lines[k].includes('|') && k + 1 < lines.length && isSep(lines[k + 1]);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      html += `<div class="code-block">${fence[2] ? `<span class="lang">${esc(fence[2])}</span>` : ''}<button class="copy-code" data-copy-code>Copier</button><pre><code>${esc(body.join('\n'))}</code></pre></div>`;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const id = `reader-h-${toc.length}`;
      toc.push({ id, level, text: heading[2].replace(/[*`_]/g, '') });
      html += `<h${level} id="${id}">${inlineMd(heading[2])}</h${level}>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${richMd(body.join('\n'), toc)}</blockquote>`;
      continue;
    }
    if (isTable(i)) {
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inlineMd(c)}</${tag}>`;
      html += `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => cell('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if (LIST.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (m) { items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10), text: m[3] }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; continue; }
        if (!lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1])) { i++; continue; }
        break;
      }
      html += renderList(items);
      continue;
    }
    const para = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !LIST.test(lines[i]) && !isTable(i)) para.push(lines[i++].trim());
    html += `<p>${para.map(inlineMd).join('<br>')}</p>`;
  }
  return html;
}

if (typeof module !== 'undefined') module.exports = { esc, linkify, escLink, md, inlineMd, renderList, richMd };
