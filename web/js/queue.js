// Attention queue: every worktree as one row saying why it needs you, grouped by the action expected.
let queueArchivesOpen = false;
let queueFixedFolded = localGet('queue-fixed-folded') === '1';

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
    return n ? `${n} agent${n > 1 ? 's' : ''} au travail · ${orchActivePhasesShort(orch)}` : 'Le maître prépare la suite';
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
  return boardWorktrees(shownWorktrees()).map((wt) => {
    const s = primarySession(wt);
    return { key: wt.path, wt, s, status: sessionStatus(wt), read: turnRead(wt), pinned: pins.has(wt.path), fixed: !!wt.mainCheckout, since: s?.statusSince || s?.updatedAt || 0, activity: lastActivity(wt) };
  });
}

const queueOrdered = () => queueFlat(queueGroups(queueItems())).filter((item) => !(queueFixedFolded && item.fixed && item.key !== selected)).map((item) => item.key);

function queueRow(item) {
  const { wt, s, status } = item;
  const group = queueGroupOf(status, item.read);
  const current = selected === wt.path;
  const master = orchestrationOf(wt);
  const age = s ? statusAge(s, status) : wt.lastCommit ? ago(wt.lastCommit.at) : '';
  const where = isAppSession(wt) ? '' : wt.otherRepo ? `${wt.repoName} · ${wt.branch || ''}` : wt.branch || (wt.head ? `@ ${wt.head}` : '');
  const trash = wt.mainCheckout || wt.locked ? '' : `<button type="button" class="queue-trash" data-queue-trash="${esc(wt.path)}" title="Supprimer le worktree" aria-label="${esc(`Supprimer ${wt.label || wt.name}`)}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1c.05.8.7 1.4 1.5 1.4h2.8c.8 0 1.45-.6 1.5-1.4l.6-8.1M6.8 7v4.5M9.2 7v4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  return `<div class="queue-rowbox"><button class="queue-row queue-${group} ${item.fixed ? 'is-fixed' : ''} ${current ? 'is-current' : ''} ${freshDone.has(wt.path) && status === 'done' ? 'is-fresh' : ''}" data-queue-path="${esc(wt.path)}" aria-current="${current}">
    <span class="queue-title">${master ? '<span class="queue-master" title="Maître orchestrateur">◆</span>' : ''}${wt.review ? '<span class="queue-tag">REVIEW</span>' : ''}${isGpt(s) ? '<span class="queue-tag queue-gpt">GPT</span>' : ''}<span class="queue-name">${esc(wt.label || wt.name)}</span>${item.pinned ? '<span class="queue-pin" title="Épinglé">★</span>' : ''}</span>
    <span class="queue-why" title="${esc(queueReason(wt, s, status))}">${esc(oneLineText(queueReason(wt, s, status)))}</span>
    ${isAppSession(wt) ? appQueueLine() : ''}<span class="queue-sub"><span class="queue-where">${esc(where)}</span><span class="queue-age">${esc(age)}</span></span>
  </button>${trash}</div>${agentsStrip(wt, 'queue')}`;
}

function queueDot(item, index) {
  const { wt, s, status } = item;
  const group = queueGroupOf(status, item.read);
  return `<button class="queue-dot queue-${group} ${orchestrationOf(wt) ? 'is-master' : ''} ${item.fixed ? 'is-fixed' : ''}" data-queue-path="${esc(wt.path)}" aria-current="${selected === wt.path}" aria-label="${esc(`${item.fixed ? 'Session fixe · ' : ''}${wt.label || wt.name}`)}" title="${esc(`${wt.label || wt.name} · ${oneLineText(queueReason(wt, s, status), 90)}`)}"><span class="queue-dot-g"></span><span class="queue-dot-n">${index + 1}</span></button>`;
}

function queueArchives() {
  if (!state.archives?.length) return '';
  const rows = state.archives.map((a) => `<div class="queue-archive"><span class="queue-archive-name" title="${esc(a.sessions?.[0]?.task || '')}">${esc(a.name)}</span>
    <button class="queue-link" data-unarchive-q="${esc(a.path)}">Restaurer</button>${a.sessions?.length ? `<button class="queue-link" data-unarchive-q="${esc(a.path)}" data-resume="1">et reprendre</button>` : ''}</div>`).join('');
  return `<div class="queue-archives"><button class="queue-section-btn" data-queue-archives aria-expanded="${queueArchivesOpen}">${queueArchivesOpen ? '▾' : '▸'} Archivées <span class="queue-n">${state.archives.length}</span></button>${queueArchivesOpen ? rows : ''}</div>`;
}

function queueFinished() {
  const n = finishedBoardCount();
  return n ? `<div class="queue-archives"><button class="queue-section-btn" data-finished-toggle aria-pressed="${finishedUi.show}">${finishedUi.show ? '▾' : '▸'} ${finishedWorktreeLabel(n)}</button></div>` : '';
}

// The fixed block folds to its header, which keeps one dot per session so a request stays visible.
const queueSection = (g) => {
  if (g.id !== FIXED_GROUP.id) return `<section class="queue-section queue-g-${g.id}" role="group" aria-label="${esc(g.label)}"><div class="queue-group"><span>${g.label}</span><span class="queue-n">${g.items.length}</span></div>${g.items.map(queueRow).join('')}</section>`;
  const dots = g.items.map((i) => `<span class="queue-fold-dot queue-${queueGroupOf(i.status, i.read)} ${selected === i.wt.path ? 'is-current' : ''}" title="${esc(i.wt.label || i.wt.name)}" aria-hidden="true"></span>`).join('');
  const waiting = g.items.filter((i) => queueGroupOf(i.status, i.read) === 'needs').length;
  const label = `${g.label}, ${g.items.length}${waiting ? `, ${waiting} attend${waiting > 1 ? 'ent' : ''} ta réponse` : ''}`;
  return `<section class="queue-section queue-g-${g.id}" role="group" aria-label="${esc(g.label)}"><button class="queue-group queue-group-toggle" data-queue-fixed-toggle aria-expanded="${!queueFixedFolded}" aria-label="${esc(label)}"><span><span aria-hidden="true">${queueFixedFolded ? '▸' : '▾'}</span> ${g.label}</span>${queueFixedFolded ? `<span class="queue-fold-dots">${dots}</span>` : ''}<span class="queue-n">${g.items.length}</span></button>${queueFixedFolded ? '' : g.items.map(queueRow).join('')}</section>`;
};

function renderQueue() {
  const nav = $('queue');
  if (!nav || !state) return;
  const groups = queueGroups(queueItems());
  const flat = queueFlat(groups);
  const work = groups.filter((g) => g.id !== FIXED_GROUP.id);
  const fixed = groups.filter((g) => g.id === FIXED_GROUP.id);
  const todo = queueByAttention(groups, 'needs').length + queueByAttention(groups, 'review').length;
  const full = `<div class="queue-head"><span>${shownWorktrees().length} worktrees · <kbd>j</kbd> <kbd>k</kbd></span><button class="queue-fold" data-queue-fold title="Replier la file ([)" aria-label="Replier la file">«</button></div>
    <div class="queue-scroll">${work.map(queueSection).join('')}
      <div class="queue-end">${todo ? `Rien d’autre après ${todo === 1 ? 'celle-ci' : `ces ${todo}`}` : 'Rien à faire pour l’instant'}</div>
      ${fixed.map(queueSection).join('')}${queueFinished()}${queueArchives()}</div>`;
  const mini = `<div class="queue-head"><button class="queue-fold" data-queue-fold title="Déplier la file ([)" aria-label="Déplier la file">»</button></div>
    <div class="queue-scroll queue-mini">${flat.map(queueDot).join('')}</div>`;
  const scroll = nav.querySelector('.queue-scroll')?.scrollTop || 0;
  setHtml(nav, queueMin ? mini : full);
  const box = nav.querySelector('.queue-scroll');
  if (box) box.scrollTop = scroll;
}

// Something is always open; j/k walk the queue.
function ensureSelection() {
  if (selected || !state?.worktrees.length) return;
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
  if (e.target.closest('[data-queue-fixed-toggle]')) { queueFixedFolded = !queueFixedFolded; localSet('queue-fixed-folded', queueFixedFolded ? '1' : '0'); renderQueue(); $('queue').querySelector('[data-queue-fixed-toggle]')?.focus(); return; }
  if (e.target.closest('[data-queue-archives]')) { queueArchivesOpen = !queueArchivesOpen; renderQueue(); return; }
  const trash = e.target.closest('[data-queue-trash]');
  if (trash) { openClose(trash.dataset.queueTrash); return; }
  const restore = e.target.closest('[data-unarchive-q]');
  if (restore) { unarchive(restore.dataset.unarchiveQ, !!restore.dataset.resume); return; }
  const row = e.target.closest('[data-queue-path]');
  if (row) select(row.dataset.queuePath);
});
