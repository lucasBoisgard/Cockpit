const SCOPE_TITLE = { work: 'Fichiers modifiés', pr: 'Modifiés depuis la PR', branch: 'Modifiés par le ticket', commit: 'Modifiés par ce commit', checkpoint: 'Modifiés depuis ce point' };
const isCheckpoint = (range) => /^[0-9a-f]{40}$/.test(range || '');
const scopeKind = (range) => (!range ? 'work' : range === 'branch' || range === 'pr' ? range : range.startsWith('commit:') ? 'commit' : 'checkpoint');
const dirOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

function shownFiles() {
  const wt = currentWt();
  if (!wt) return [];
  return since ? sinceFiles || [] : wt.files;
}

function groupedFiles() {
  const needle = fileFilter.toLowerCase();
  const groups = new Map();
  for (const f of shownFiles()) {
    if (needle && !f.path.toLowerCase().includes(needle)) continue;
    const dir = dirOf(f.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, list]) => [dir, list.sort((a, b) => a.path.localeCompare(b.path))]);
}

const orderedFiles = () => groupedFiles().flatMap(([, list]) => list.map((f) => f.path));

function fileTree(shown) {
  if (!shown.length) return `<div class="tl"><span></span><span class="what">${since && !sinceFiles ? 'Chargement…' : 'Aucun changement'}</span></div>`;
  const groups = groupedFiles();
  if (!groups.length) return '<div class="tl"><span></span><span class="what">Aucun fichier ne correspond</span></div>';
  const fileRow = (f, nested) => {
    const code = f.code === '??' ? 'U' : f.code.length > 1 ? f.code.charAt(1) : f.code;
    const stat = f.added || f.deleted ? `<span class="fstat"><span class="plus">+${f.added || 0}</span> <span class="minus">−${f.deleted || 0}</span></span>` : '';
    const name = nested ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path;
    return `<div class="file ${nested ? 'nested' : ''} ${selectedFile === f.path ? 'active' : ''}" data-file="${esc(f.path)}" title="${esc(f.path)}"><span class="code ${code}">${code}</span><span class="fpath">&lrm;${esc(name)}</span>${stat}</div>`;
  };
  return groups.map(([dir, list]) => {
    if (!dir) return list.map((f) => fileRow(f, false)).join('');
    const closed = collapsedDirs.has(dir) && !fileFilter;
    return `<button class="dir" data-dir="${esc(dir)}" title="${esc(dir)}"><span class="caret">${closed ? '▸' : '▾'}</span><span class="dpath">&lrm;${esc(dir)}/&lrm;</span><span>${list.length}</span></button>${closed ? '' : list.map((f) => fileRow(f, true)).join('')}`;
  }).join('');
}

function stepFile(delta) {
  const files = orderedFiles();
  if (!files.length) return;
  const index = files.indexOf(selectedFile);
  const next = files[index < 0 ? 0 : Math.max(0, Math.min(files.length - 1, index + delta))];
  if (next === selectedFile) return;
  selectedFile = next;
  collapsedDirs.delete(dirOf(next));
  renderPanel();
  loadDiff();
  document.querySelector('#file-tree .file.active')?.scrollIntoView({ block: 'nearest' });
}

async function openChanges() {
  const wt = currentWt();
  if (!wt) return;
  if (ticket?.path !== wt.path) {
    const res = !wt.branch || wt.branch === state.baseBranch ? null : await api(`/api/commits?wt=${encodeURIComponent(wt.path)}`).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    if (currentWt()?.path !== wt.path) return;
    ticket = { path: wt.path, base: data?.base || state.baseBranch, commits: data?.commits || [], pr: data?.pr || null };
  }
  loadSince();
}

async function loadSince() {
  sinceFiles = null;
  renderPanel();
  if (since) {
    const path = selected;
    const range = since;
    const res = await api(`/api/changes?wt=${encodeURIComponent(path)}&since=${encodeURIComponent(range)}`).catch(() => null);
    if (selected !== path || since !== range) return;
    sinceFiles = res?.ok ? await res.json() : [];
  }
  if (!selectedFile || !shownFiles().some((f) => f.path === selectedFile)) selectedFile = orderedFiles()[0] || null;
  renderPanel();
  loadDiff();
}

let sinceRefreshedAt = 0;

async function refreshSinceFiles() {
  if (!since || tab !== 'changes' || Date.now() - sinceRefreshedAt < 10000) return;
  sinceRefreshedAt = Date.now();
  const path = selected;
  const range = since;
  const res = await api(`/api/changes?wt=${encodeURIComponent(path)}&since=${encodeURIComponent(range)}`).catch(() => null);
  if (!res?.ok || selected !== path || since !== range) return;
  sinceFiles = await res.json();
  renderPanel();
}

async function loadDiff() {
  const box = $('diff');
  if (!selectedFile) { box.innerHTML = '<div class="placeholder">Choisis un fichier pour voir son diff</div>'; return; }
  const file = selectedFile;
  const res = await api(`/api/diff?wt=${encodeURIComponent(selected)}&file=${encodeURIComponent(file)}${since ? `&since=${encodeURIComponent(since)}` : ''}`);
  const text = await res.text();
  if (file !== selectedFile) return;
  lastDiffText = text;
  renderDiff();
  $('diff').scrollTop = 0;
}

const commentsFor = (wtPath) => reviewComments.get(wtPath) || [];

function renderDiff(editLine) {
  const box = $('diff');
  const comments = commentsFor(selected);
  let newLine = 0;
  const single = (lastDiffText.match(/^diff /gm) || []).length <= 1;
  const lines = lastDiffText.split('\n').map((l) => {
    const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) newLine = Number(hunk[1]);
    if (/^(index |--- |\+\+\+ )/.test(l) || (single && l.startsWith('diff '))) return '';
    const meta = /^(diff |new file|deleted file)/.test(l);
    const cls = hunk ? 'hunk' : meta ? 'meta-line' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
    let ln = null;
    if (!hunk && !meta && newLine && (l.startsWith('+') || l.startsWith(' '))) ln = newLine++;
    const notes = ln ? comments.map((c, i) => [c, i]).filter(([c]) => c.file === selectedFile && c.line === ln).map(([c, i]) => `<div class="cm-note"><span>💬 ${esc(c.text)}</span><button data-uncomment="${i}" title="Supprimer ce commentaire">✕</button></div>`).join('') : '';
    const editor = ln && ln === editLine ? `<div class="cm-edit"><textarea id="cm-text" placeholder="Ta remarque sur la ligne ${ln}"></textarea><div class="row-btn"><button class="btn primary" data-cm-save="${ln}">Ajouter</button><button class="btn" data-cm-cancel="1">Annuler</button></div></div>` : '';
    return `<div class="line ${cls}" ${ln ? `data-ln="${ln}"` : ''}>${ln ? `<button class="cm-add" data-comment="${ln}" title="Commenter la ligne ${ln}">+</button>` : ''}${esc(l) || ' '}</div>${notes}${editor}`;
  }).join('');
  const bar = comments.length ? `<div class="review-bar">💬 ${comments.length} commentaire${comments.length > 1 ? 's' : ''} en attente<button class="btn primary" id="cm-send">Envoyer à Claude</button><button class="btn" id="cm-clear">Vider</button></div>` : '';
  const files = orderedFiles();
  const pos = files.indexOf(selectedFile);
  const head = `<div class="diff-head">
    <button class="btn" data-step="-1" title="Fichier précédent (k)" ${pos <= 0 ? 'disabled' : ''}>‹</button>
    <span class="pos">${pos + 1} / ${files.length}</span>
    <button class="btn" data-step="1" title="Fichier suivant (j)" ${pos < 0 || pos >= files.length - 1 ? 'disabled' : ''}>›</button>
    <span class="dpath" title="${esc(selectedFile)}">&lrm;${esc(selectedFile)}</span>
    <button class="btn" data-copy-path title="Copier le chemin du fichier">Copier le chemin</button>
    <button class="btn" data-wide title="${changesWide ? 'Revenir à la largeur normale' : 'Afficher le panneau en plein écran'}">${changesWide ? 'Réduire' : 'Agrandir'}</button>
  </div>`;
  box.innerHTML = head + bar + (lines || '<div class="placeholder">Pas de diff</div>');
  if (editLine) $('cm-text')?.focus();
}

function addComment(line) {
  const text = $('cm-text')?.value.trim();
  if (!text) return;
  const raw = lastDiffText.split('\n');
  let newLine = 0;
  let code = '';
  for (const l of raw) {
    const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (newLine && (l.startsWith('+') || l.startsWith(' ')) && !l.startsWith('+++')) {
      if (newLine === line) { code = l.slice(1).trim(); break; }
      newLine++;
    }
  }
  reviewComments.set(selected, [...commentsFor(selected), { file: selectedFile, line, code: code.slice(0, 160), text }]);
  renderDiff();
}

async function sendComments() {
  const wt = currentWt();
  const comments = commentsFor(selected);
  const target = currentSession()?.live ? currentSession() : liveSession(wt);
  if (!target) { toast('Aucune session pilotable dans ce worktree.', 'error'); return; }
  const text = ['Commentaires de revue sur tes changements :', '', ...comments.map((c, i) => `${i + 1}. ${c.file}:${c.line}${c.code ? ` — \`${c.code}\`` : ''}\n   → ${c.text}`), '', 'Traite chaque point, puis résume ce que tu as changé.'].join('\n');
  const result = await post('/api/deliver', { target: target.sessionId, text });
  if (!result.ok) { toast(result.data.error || 'Envoi impossible.', 'error'); return; }
  reviewComments.delete(selected);
  renderDiff();
  toast(result.data.outcome === 'queued' ? 'Commentaires mis en file : ils partent à la fin du tour en cours.' : 'Commentaires envoyés à Claude.');
}

$('panel').addEventListener('change', (e) => {
  if (e.target.id !== 'since-select') return;
  since = e.target.value || null;
  loadSince();
});

$('file-filter').addEventListener('input', (e) => {
  fileFilter = e.target.value.trim();
  renderPanel();
});
