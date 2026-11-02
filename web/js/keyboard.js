document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !selected) return;
  if (document.querySelector('dialog[open]')) return;
  closePanel();
});

function moveFocus(delta) {
  const cards = [...document.querySelectorAll('#grid .card')];
  if (!cards.length) return;
  focusIndex = Math.max(0, Math.min(cards.length - 1, focusIndex < 0 ? 0 : focusIndex + delta));
  cards.forEach((c, i) => c.classList.toggle('focused', i === focusIndex));
  cards[focusIndex].scrollIntoView({ block: 'nearest' });
}

const focusedCard = () => document.querySelectorAll('#grid .card')[focusIndex] || null;

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (document.activeElement === $('screen')) return;
    e.preventDefault();
    openPalette();
    return;
  }
  const el = document.activeElement;
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || el === $('screen') || el?.closest?.('input, textarea, select, [contenteditable]')) return;
  const panelOpen = $('panel').classList.contains('open');
  if ((e.key === 'j' || e.key === 'k') && panelOpen && tab === 'changes') { e.preventDefault(); stepFile(e.key === 'j' ? 1 : -1); return; }
  if (e.key === 'j' || e.key === 'k') { e.preventDefault(); moveFocus(e.key === 'j' ? 1 : -1); return; }
  if (e.key === 'Enter' && focusedCard()) { e.preventDefault(); focusedCard().click(); return; }
  if (e.key === ' ' && focusedCard()) {
    e.preventDefault();
    const peek = focusedCard().querySelector('[data-peek]');
    if (peek) { openPeeks.has(peek.dataset.peek) ? openPeeks.delete(peek.dataset.peek) : openPeeks.add(peek.dataset.peek); peek.classList.toggle('open'); }
    return;
  }
  if (e.key === 'a') {
    const path = focusedCard()?.dataset.path || (panelOpen ? selected : null);
    const wt = state.worktrees.find((w) => w.path === path);
    const s = wt && liveSession(wt);
    if (s?.status === 'needs_input') { post('/api/keys', { target: s.sessionId, ops: [{ literal: '1' }] }).then(() => { toast(`Permission accordée à ${wt.name}.`); setTimeout(refresh, 800); }); }
    return;
  }
  if (/^[1-6]$/.test(e.key) && panelOpen) { document.querySelectorAll('#tabs button')[Number(e.key) - 1]?.click(); return; }
  if (e.key === 'l' && panelOpen && currentSession()) { e.preventDefault(); openReaderFor(currentSession().sessionId, currentWt()?.name); return; }
  if (e.key === 'l' && focusedCard()?.dataset.path) {
    const wt = state.worktrees.find((w) => w.path === focusedCard().dataset.path);
    if (wt?.sessions[0]) { e.preventDefault(); openReaderFor(wt.sessions[0].sessionId, wt.name); }
    return;
  }
  if (e.key === 'n') { e.preventDefault(); openNewSession(); return; }
  if (e.key === 'H' || e.key === 'h') { e.preventDefault(); openHistory(); return; }
  if (e.key === '?') { $('help-dialog').showModal(); }
});
