const FX_STALE_MS = 15000;
const FX_RENDERED = /\.(md|markdown)$/i;
const fx = { path: null, list: null, tree: null, loadedAt: 0, loadingPath: null, open: new Set(), query: '', file: null, content: null, rendered: true, view: null };

function resetFiles() {
  Object.assign(fx, { path: null, list: null, tree: null, loadedAt: 0, loadingPath: null, query: '', file: null, content: null, view: null });
  fx.open.clear();
  $('fx-filter').value = '';
}

function fxMarks() {
  const exact = new Map();
  const untrackedDirs = [];
  for (const f of currentWt()?.files || []) {
    if (f.code === '??' && f.path.endsWith('/')) untrackedDirs.push(f.path);
    else exact.set(f.path, statusMark(f.code));
  }
  const markOf = (file) => exact.get(file) || (untrackedDirs.some((dir) => file.startsWith(dir)) ? 'U' : null);
  const changedDirs = new Set([...exact.keys(), ...untrackedDirs.map((d) => `${d}x`)].flatMap(ancestorDirs));
  return { exact, markOf, changedDirs };
}

async function openFiles(force = false) {
  const wt = currentWt();
  if (!wt) return;
  if (fx.path !== wt.path) { resetFiles(); fx.path = wt.path; }
  renderFiles();
  if (fx.loadingPath === wt.path || (!force && fx.list && Date.now() - fx.loadedAt < FX_STALE_MS)) return;
  const target = wt.path;
  fx.loadingPath = target;
  const res = await api(`/api/files?wt=${encodeURIComponent(target)}`).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (fx.loadingPath === target) fx.loadingPath = null;
  if (fx.path !== target) return;
  fx.list = data || { files: [], truncated: false, error: true };
  fx.tree = buildFileTree(fx.list.files);
  fx.loadedAt = Date.now();
  renderFiles();
  if (fx.file) loadFile(fx.file, true);
}

const fxMarkHtml = (mark) => (mark ? `<span class="code ${esc(mark)}">${esc(mark)}</span>` : '');

function fxRow(row, marks) {
  if (row.kind === 'dir') {
    const dot = marks.changedDirs.has(row.path) ? '<span class="fx-dot" title="Contient des fichiers modifiés"></span>' : '';
    return `<button class="fx-dir" data-fx-dir="${esc(row.path)}" style="padding-left: ${8 + row.depth * 14}px" title="${esc(row.path)}"><span class="fx-caret">${row.open ? '▾' : '▸'}</span><span class="fx-name">${esc(row.name)}</span>${dot}</button>`;
  }
  return `<button class="fx-file ${fx.file === row.path ? 'on' : ''}" data-fx-file="${esc(row.path)}" style="padding-left: ${24 + row.depth * 14}px" title="${esc(row.path)}"><span class="fx-name">${esc(row.name)}</span>${fxMarkHtml(marks.markOf(row.path))}</button>`;
}

function fxTreeHtml(marks) {
  if (!fx.list) return '<div class="fx-empty">Chargement…</div>';
  if (fx.list.error) return '<div class="fx-empty">Liste des fichiers indisponible.</div>';
  if (!fx.list.files.length) return '<div class="fx-empty">Aucun fichier suivi.</div>';
  if (fx.query) {
    const hits = searchFiles(fx.list.files, fx.query);
    if (!hits.length) return '<div class="fx-empty">Aucun fichier ne correspond.</div>';
    return hits.map((file) => {
      const slash = file.lastIndexOf('/');
      return `<button class="fx-file fx-hit ${fx.file === file ? 'on' : ''}" data-fx-file="${esc(file)}" title="${esc(file)}"><span class="fx-name">${esc(file.slice(slash + 1))}</span><span class="fx-dirname">&lrm;${esc(file.slice(0, Math.max(slash, 0)))}&lrm;</span>${fxMarkHtml(marks.markOf(file))}</button>`;
    }).join('');
  }
  return fileTreeRows(fx.tree, fx.open).map((row) => fxRow(row, marks)).join('');
}

function fxBodyHtml(c, isMd) {
  if (!c) return '<div class="placeholder">Chargement…</div>';
  if (c.error) return '<div class="placeholder">Lecture impossible.</div>';
  if (c.missing) return '<div class="placeholder">Ce fichier n\'existe plus sur le disque.</div>';
  if (c.binary) return `<div class="placeholder">Fichier binaire (${humanSize(c.size)}) : pas d'aperçu.</div>`;
  const cut = c.truncated ? `<div class="fx-cut">Fichier de ${humanSize(c.size)} : seul le début est affiché.</div>` : '';
  if (isMd && fx.rendered) return `${cut}<article class="reader-doc fx-doc">${richMd(c.content).replace(/ id="reader-h-\d+"/g, '')}</article>`;
  const text = c.content.endsWith('\n') ? c.content.slice(0, -1) : c.content;
  const count = text ? text.split('\n').length : 1;
  const gutter = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  return `${cut}<div class="fx-code"><pre class="fx-gutter" aria-hidden="true">${gutter}</pre><pre class="fx-text">${esc(text)}</pre></div>`;
}

function fxViewerHtml(marks) {
  if (!fx.file) return '<div class="placeholder">Choisis un fichier pour l\'afficher</div>';
  const c = fx.content;
  const mark = marks.markOf(fx.file);
  const isMd = FX_RENDERED.test(fx.file);
  const key = [fx.file, mark, fx.rendered, changesWide].join('\0');
  if (fx.view?.key === key && fx.view.content === c) return fx.view.html;
  const head = `<div class="fx-head">
    <span class="fx-path" title="${esc(fx.file)}">&lrm;${esc(fx.file)}</span>
    ${c && !c.missing && !c.error ? `<span class="fx-size">${humanSize(c.size)}</span>` : ''}
    ${marks.exact.has(fx.file) ? '<button class="btn" data-fx-diff title="Ouvrir ce fichier dans Changements">Voir le diff</button>' : ''}
    ${isMd && c?.content !== undefined ? `<button class="btn" data-fx-render>${fx.rendered ? 'Source' : 'Rendu'}</button>` : ''}
    <button class="btn" data-fx-cite title="Mentionner ce fichier dans le message à Claude">Citer</button>
    <button class="btn" data-fx-copy title="Copier le chemin du fichier">Copier le chemin</button>
    <button class="btn" data-fx-wide>${changesWide ? 'Réduire' : 'Agrandir'}</button>
  </div>`;
  const html = head + fxBodyHtml(c, isMd);
  fx.view = { key, content: c, html };
  return html;
}

function fxSetHtml(el, html) {
  if (el.fxHtml === html) return;
  el.fxHtml = html;
  el.innerHTML = html;
}

function renderFiles() {
  if (tab !== 'files') return;
  const marks = fxMarks();
  $('fx-count').textContent = fx.list ? `${fx.list.files.length.toLocaleString('fr-FR')} fichiers${fx.list.truncated ? ' (liste tronquée)' : ''}` : '';
  fxSetHtml($('fx-tree'), fxTreeHtml(marks));
  fxSetHtml($('fx-viewer'), fxViewerHtml(marks));
}

async function loadFile(file, keepScroll = false) {
  const target = fx.path;
  fx.file = file;
  if (!keepScroll) fx.content = null;
  for (const dir of ancestorDirs(file)) fx.open.add(dir);
  renderFiles();
  const res = await api(`/api/file?wt=${encodeURIComponent(target)}&file=${encodeURIComponent(file)}`).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (fx.path !== target || fx.file !== file) return;
  const same = data && fx.content && ['content', 'size', 'binary', 'missing'].every((k) => data[k] === fx.content[k]);
  if (!same) fx.content = data || { error: true };
  renderFiles();
  if (!keepScroll) $('fx-viewer').scrollTop = 0;
}

function citeFile(file) {
  const input = $('composer-input');
  tab = 'chat'; localSet('tab', tab); renderTabs(); loadChat(true);
  const at = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, at);
  input.value = `${before}${before && !/\s$/.test(before) ? ' ' : ''}@${file} ${input.value.slice(at)}`;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

$('files-view').addEventListener('click', async (e) => {
  const dir = e.target.closest('[data-fx-dir]');
  if (dir) { const p = dir.dataset.fxDir; fx.open.has(p) ? fx.open.delete(p) : fx.open.add(p); renderFiles(); return; }
  const file = e.target.closest('[data-fx-file]');
  if (file) { loadFile(file.dataset.fxFile); return; }
  const code = e.target.closest('[data-copy-code]');
  if (code) { const ok = await copyText(code.parentElement.querySelector('code').textContent); code.textContent = ok ? 'Copié' : 'Échec'; setTimeout(() => (code.textContent = 'Copier'), 1500); return; }
  if (e.target.closest('[data-fx-refresh]')) { openFiles(true); return; }
  if (e.target.closest('[data-fx-collapse]')) { fx.open.clear(); renderFiles(); return; }
  if (e.target.closest('[data-fx-render]')) { fx.rendered = !fx.rendered; renderFiles(); return; }
  if (e.target.closest('[data-fx-copy]')) { copyText(fx.file).then((ok) => toast(ok ? 'Chemin copié.' : 'Copie impossible.', ok ? '' : 'error')); return; }
  if (e.target.closest('[data-fx-cite]')) { citeFile(fx.file); return; }
  if (e.target.closest('[data-fx-wide]')) { changesWide = !changesWide; localSet('changesWide', changesWide ? '1' : '0'); renderTabs(); renderFiles(); return; }
  if (e.target.closest('[data-fx-diff]')) {
    resetChanges(); selectedFile = fx.file;
    tab = 'changes'; localSet('tab', tab); renderTabs(); openChanges();
  }
});

$('fx-filter').addEventListener('input', (e) => { fx.query = e.target.value.trim(); renderFiles(); });
$('fx-filter').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = $('fx-tree').querySelector('[data-fx-file]');
  if (first) loadFile(first.dataset.fxFile);
});
