// Attention queue: every worktree as one row saying why it needs you, grouped by the action expected.
let queueArchivesOpen = false;

const orchestrationOf = (wt) => wt.sessions.map((s) => state.orchestrations?.[s.sessionId]).find(Boolean) || null;
const oneLineText = (text, max = 140) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

function queueReason(wt, s, st) {
  const orch = orchestrationOf(wt);
  if (!s) return wt.lastCommit ? wt.lastCommit.subject : 'Aucune session';
  if (st === 'needs_input') return s.message || (s.permission ? 'Demande une permission' : 'Attend ta réponse');
  if (orch && st === 'working') {
    const n = orch.counts.working + orch.counts.starting;
    return n ? `${n} agent${n > 1 ? 's' : ''} au travail · ${orch.phases[orch.phase] || 'sans plan'}` : 'Le maître prépare la suite';
  }
  if (st === 'working') {
    if (backgroundOnly(s)) return 'Agents en arrière-plan';
    const last = s.actions?.[0];
    return last ? `${last.tool} · ${last.detail || ''}` : 'Claude travaille';
  }
  if (st === 'done') return plainLine(s.lastAssistant) || 'Tour terminé';
  return s.task || wt.lastCommit?.subject || 'Session ouverte';
}

function queueItems() {
  return shownWorktrees().map((wt) => {
    const s = primarySession(wt);
    return { key: wt.path, wt, s, status: sessionStatus(wt), pinned: pins.has(wt.path), since: s?.statusSince || s?.updatedAt || 0, activity: lastActivity(wt) };
  });
}

const queueOrdered = () => queueFlat(queueGroups(queueItems())).map((item) => item.key);

function queueRow(item) {
  const { wt, s, status } = item;
  const group = queueGroupOf(status);
  const current = selected === wt.path;
  const master = orchestrationOf(wt);
  const age = s ? statusAge(s, status) : wt.lastCommit ? ago(wt.lastCommit.at) : '';
  const where = wt.otherRepo ? `${wt.repoName} · ${wt.branch || ''}` : wt.branch || (wt.head ? `@ ${wt.head}` : '');
  return `<button class="queue-row queue-${group} ${current ? 'is-current' : ''} ${freshDone.has(wt.path) && status === 'done' ? 'is-fresh' : ''}" data-queue-path="${esc(wt.path)}" aria-current="${current}">
    ${selecting ? `<input type="checkbox" class="queue-pick" data-queue-pick="${esc(wt.path)}" ${picked.has(wt.path) ? 'checked' : ''} tabindex="-1" aria-label="Sélectionner ${esc(wt.name)}">` : ''}
    <span class="queue-title">${master ? '<span class="queue-master" title="Maître orchestrateur">◆</span>' : ''}${wt.review ? '<span class="queue-tag">REVIEW</span>' : ''}${isGpt(s) ? '<span class="queue-tag queue-gpt">GPT</span>' : ''}<span class="queue-name">${esc(wt.label || wt.name)}</span>${item.pinned ? '<span class="queue-pin" title="Épinglé">★</span>' : ''}</span>
    <span class="queue-why" title="${esc(queueReason(wt, s, status))}">${esc(oneLineText(queueReason(wt, s, status)))}</span>
    <span class="queue-sub"><span class="queue-where">${esc(where)}</span><span class="queue-age">${esc(age)}</span></span>
  </button>`;
}

function queueDot(item, index) {
  const { wt, s, status } = item;
  const group = queueGroupOf(status);
  return `<button class="queue-dot queue-${group} ${orchestrationOf(wt) ? 'is-master' : ''}" data-queue-path="${esc(wt.path)}" aria-current="${selected === wt.path}" title="${esc(`${wt.label || wt.name} · ${oneLineText(queueReason(wt, s, status), 90)}`)}"><span class="queue-dot-g"></span><span class="queue-dot-n">${index + 1}</span></button>`;
}

function queueArchives() {
  if (!state.archives?.length) return '';
  const rows = state.archives.map((a) => `<div class="queue-archive"><span class="queue-archive-name" title="${esc(a.sessions?.[0]?.task || '')}">${esc(a.name)}</span>
    <button class="queue-link" data-unarchive-q="${esc(a.path)}">Restaurer</button>${a.sessions?.length ? `<button class="queue-link" data-unarchive-q="${esc(a.path)}" data-resume="1">et reprendre</button>` : ''}</div>`).join('');
  return `<div class="queue-archives"><button class="queue-section-btn" data-queue-archives aria-expanded="${queueArchivesOpen}">${queueArchivesOpen ? '▾' : '▸'} Archivées <span class="queue-n">${state.archives.length}</span></button>${queueArchivesOpen ? rows : ''}</div>`;
}

function queueFinished() {
  const n = finishedBoardCount();
  return n ? `<div class="queue-archives"><button class="queue-section-btn" data-finished-toggle aria-pressed="${finishedUi.show}">${finishedUi.show ? '▾' : '▸'} ${finishedLabel(n)}</button></div>` : '';
}

function renderQueue() {
  const nav = $('queue');
  if (!nav || !state || !isWorkstation()) return;
  const groups = queueGroups(queueItems());
  const flat = queueFlat(groups);
  const todo = flat.filter((i) => ['needs', 'review'].includes(queueGroupOf(i.status))).length;
  const full = `<div class="queue-head"><span>${shownWorktrees().length} worktrees · <kbd>j</kbd> <kbd>k</kbd></span><button class="queue-fold" data-queue-fold title="Replier la file ([)" aria-label="Replier la file">«</button></div>
    <div class="queue-scroll">${groups.map((g) => `<div class="queue-group queue-g-${g.id}"><span>${g.label}</span><span class="queue-n">${g.items.length}</span></div>${g.items.map(queueRow).join('')}`).join('')}
      <div class="queue-end">${todo ? `Rien d’autre après ${todo === 1 ? 'celle-ci' : `ces ${todo}`}` : 'Rien à faire pour l’instant'}</div>
      ${queueFinished()}${queueArchives()}</div>`;
  const mini = `<div class="queue-head"><button class="queue-fold" data-queue-fold title="Déplier la file ([)" aria-label="Déplier la file">»</button></div>
    <div class="queue-scroll queue-mini">${flat.map(queueDot).join('')}</div>`;
  const scroll = nav.querySelector('.queue-scroll')?.scrollTop || 0;
  setHtml(nav, queueMin ? mini : full);
  const box = nav.querySelector('.queue-scroll');
  if (box) box.scrollTop = scroll;
}

// Workstation: something is always open; j/k walk the queue.
function ensureSelection() {
  if (!isWorkstation() || selected || !state?.worktrees.length) return;
  const first = queueOrdered()[0];
  if (first) select(first);
}

function stepQueue(delta) {
  const order = queueOrdered();
  if (!order.length) return;
  const index = order.indexOf(selected);
  const next = order[Math.max(0, Math.min(order.length - 1, index < 0 ? 0 : index + delta))];
  if (next && next !== selected) select(next);
  document.querySelector(`#queue [data-queue-path="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
}

$('queue').addEventListener('click', (e) => {
  if (e.target.closest('[data-queue-fold]')) { toggleQueue(); return; }
  if (e.target.closest('[data-queue-archives]')) { queueArchivesOpen = !queueArchivesOpen; renderQueue(); return; }
  const restore = e.target.closest('[data-unarchive-q]');
  if (restore) { unarchive(restore.dataset.unarchiveQ, !!restore.dataset.resume); return; }
  const pick = e.target.closest('[data-queue-pick]');
  const row = e.target.closest('[data-queue-path]');
  if (selecting && row && row.dataset.queuePath !== SHELL && row.dataset.queuePath !== USAGE) {
    const key = row.dataset.queuePath;
    if (pick ? pick.checked : !picked.has(key)) picked.add(key); else picked.delete(key);
    renderGrid();
    return;
  }
  if (row) select(row.dataset.queuePath);
});
