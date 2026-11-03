function buildPalette() {
  const items = [];
  const wt = currentWt();
  for (const w of state.worktrees) items.push({ label: `Aller à ${w.name}`, kind: w.branch || '', run: () => select(w.path) });
  if (wt) {
    for (const b of document.querySelectorAll('#tabs button')) items.push({ label: `Onglet ${b.textContent.trim()}`, kind: wt.name, run: () => b.click() });
    if (!isBase(wt) && state.pr?.enabled && wt.pr?.state !== 'OPEN') items.push({ label: 'Pousser et ouvrir la PR', kind: wt.name, run: () => openPrDialog(wt.path) });
    if (wt.name !== 'main') items.push({ label: 'Archiver ce worktree', kind: wt.name, run: () => archive(wt.path) });
    if (state.app && wt.name !== 'main') items.push({ label: "Servir l'app depuis ce worktree", kind: wt.name, run: () => serveApp(wt.path) });
  }
  items.push(
    { label: 'Nouvelle session', kind: 'action', run: () => openNewSession() },
    { label: 'Historique des sessions', kind: 'action', run: openHistory },
    { label: 'Skills', kind: 'action', run: () => openSkills() },
    { label: 'Nettoyage des worktrees', kind: 'action', run: openCleanup },
    { label: 'Automatisations', kind: 'action', run: openAutomations },
    { label: 'Écrire à plusieurs sessions', kind: 'action', run: startSelecting },
    { label: order === 'state' ? 'Ordre fixe' : 'Grouper par état', kind: 'affichage', run: () => setOrder(order === 'state' ? 'fixed' : 'state') },
    { label: 'Terminal', kind: 'outil', run: () => select(SHELL) },
    { label: 'Tokens', kind: 'outil', run: () => select(USAGE) },
    { label: 'Raccourcis clavier', kind: 'aide', run: () => $('help-dialog').showModal() },
  );
  return items;
}

function fuzzy(text, query) {
  let i = 0;
  const t = text.toLowerCase();
  for (const ch of query.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

function renderPalette() {
  const q = $('palette-q').value.trim();
  const items = buildPalette().filter((it) => !q || fuzzy(`${it.label} ${it.kind}`, q));
  paletteItems = items.slice(0, 40);
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  $('palette-list').innerHTML = paletteItems.map((it, i) => `<button data-palette="${i}" class="${i === paletteIndex ? 'on' : ''}">${esc(it.label)}<span class="kind">${esc(it.kind)}</span></button>`).join('') || '<div class="placeholder">Rien ne correspond.</div>';
  $('palette-list').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  $('palette-q').value = '';
  paletteIndex = 0;
  if (!$('palette-dialog').open) $('palette-dialog').showModal();
  renderPalette();
  $('palette-q').focus();
}

function runPalette(i) {
  const it = paletteItems[i];
  if (!it) return;
  $('palette-dialog').close();
  it.run();
}

$('palette-q').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
$('palette-q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
  else if (e.key === 'Escape') { e.preventDefault(); $('palette-dialog').close(); }
});
$('palette-list').addEventListener('click', (e) => { const b = e.target.closest('[data-palette]'); if (b) runPalette(Number(b.dataset.palette)); });
