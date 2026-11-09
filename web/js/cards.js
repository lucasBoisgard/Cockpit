const branchLabel = (wt) => wt.branch || `HEAD détachée @ ${wt.head || '?'}`;
const canServe = (wt) => !!wt && !wt.mainCheckout && !wt.otherRepo;

function branchChip(wt) {
  const change = branchChanges.get(wt.path);
  const recent = change && Date.now() - change.at < BRANCH_CHANGE_MS;
  const title = recent ? `Branche changée récemment (avant : ${change.from})` : 'Branche checkoutée dans ce worktree';
  return `<span class="branch-chip ${wt.branch ? '' : 'detached'} ${recent ? 'changed' : ''}" title="${esc(title)}">⎇ ${esc(branchLabel(wt))}</span>`;
}

function trackBranches() {
  for (const wt of state.worktrees) {
    const current = branchLabel(wt);
    const before = knownBranches.get(wt.path);
    if (before !== undefined && before !== current) {
      branchChanges.set(wt.path, { from: before, at: Date.now() });
      toast(`${wt.name} : branche ${before} → ${current}`);
    }
    knownBranches.set(wt.path, current);
  }
}

function renderCounters() {
  if (isWorkstation()) { renderTopbar(); $('worktree-names').innerHTML = state.worktrees.filter((w) => !w.mainCheckout).map((w) => `<option value="${esc(w.name)}">`).join(''); return; }
  $('tools-menu').querySelector('summary').textContent = 'Outils ▾';
  $('topbar-tools').innerHTML = '';
  $('repo-title').innerHTML = `Worktrees<span class="repo" title="${esc(state.repo)}">${esc(state.repoName)}</span>`;
  const count = (st) => shownWorktrees().filter((w) => sessionStatus(w) === st).length;
  const dirty = shownWorktrees().filter((w) => w.files.length).length;
  $('counters').innerHTML = [
    ['needs', count('needs_input'), 'attendent ta réponse'],
    ['working', count('working'), 'en cours'],
    ['done', count('done'), 'terminées'],
    ['', dirty, 'avec changements'],
  ].map(([cls, n, label]) => `<span class="counter ${n ? cls : ''}">${n} ${label}</span>`).join('')
    + limitAlerts().map((w) => `<span class="counter limit-${w.level}" title="${esc(resetText(w))}">Limite ${esc(w.label)} : ${w.pct} % utilisés</span>`).join('');
  $('updated').textContent = `${shownWorktrees().length} worktrees · mis à jour ${new Date(state.generatedAt).toLocaleTimeString()}`;
  $('worktree-names').innerHTML = state.worktrees.filter((w) => !w.mainCheckout).map((w) => `<option value="${esc(w.name)}">`).join('');
}

function shellCard() {
  const live = state.shell?.live;
  return `<button class="tool-pill ${selected === SHELL ? 'selected' : ''}" data-shell="1" title="Session tmux persistante, indépendante des worktrees : elle survit à la fermeture de la page">
    <span class="pill-dot ${live ? 'on' : ''}"></span><b>Terminal</b><span class="pill-sub">${live ? 'ouvert' : 'démarre au clic'}</span>
  </button>`;
}

function prChip(pr) {
  if (!pr) return '';
  let cls = 'pr-open';
  let label = `#${pr.number}`;
  if (pr.state === 'MERGED') { cls = 'pr-merged'; label += ' mergée'; }
  else if (pr.state === 'CLOSED') { cls = 'pr-closed'; label += ' fermée'; }
  else if (pr.draft) { cls = 'pr-draft'; label += ' draft'; }
  else if (pr.failing) { cls = 'pr-failing'; label += ` · CI ✕ ${pr.failing}`; }
  else if (pr.review === 'CHANGES_REQUESTED') { cls = 'pr-changes'; label += ' · changements demandés'; }
  else if (pr.pending) { cls = 'pr-pending'; label += ' · CI en cours'; }
  else if (pr.review === 'APPROVED') { cls = 'pr-ready'; label += ' · prête'; }
  else label += ' · review attendue';
  const title = `${pr.title || ''}\nChecks : ${pr.passing} ok · ${pr.pending} en cours · ${pr.failing} en échec`;
  return `<a class="chip pr ${cls}" href="${esc(pr.url)}" target="_blank" rel="noopener" title="${esc(title)}">${esc(label)}</a>`;
}

function extChips(wt) {
  const repos = new Map();
  for (const s of wt.sessions.slice(0, 3)) for (const r of s.externalRepos || []) repos.set(r.path, r);
  return [...repos.values()].map((r) => `<span class="ext-chip" title="La session modifie aussi des fichiers de ${esc(r.path)}">aussi : ${esc(r.name)}${r.branch ? ` ⎇ ${esc(r.branch)}` : ''}</span>`).join('');
}

function quickBlock(wt, s, st) {
  if (!s) return '';
  const parts = [];
  const keyBtn = (key, label, cls = '') => `<button class="btn ${cls}" data-quick-key="${key}" data-session="${esc(s.sessionId)}">${esc(label)}</button>`;
  if (st === 'needs_input' && s.live) {
    if (s.question?.options?.length) parts.push(`<div class="quick-keys">${s.question.options.map((o, i) => keyBtn(i + 1, `${i + 1}. ${o}`)).join('')}</div>`);
    else if (s.permission && !isGpt(s)) parts.push(`<div class="quick-keys">${keyBtn(1, 'Autoriser', 'allow')}${keyBtn(2, 'Toujours autoriser')}${keyBtn(3, 'Refuser', 'deny')}</div>`);
  }
  if (s.lastAssistant && ['done', 'idle'].includes(s.status)) {
    parts.push(`<div class="peek ${openPeeks.has(wt.path) ? 'open' : ''}" data-peek="${esc(wt.path)}" title="Clique pour déplier"><b>Claude :</b> ${esc(s.lastAssistant)}<button class="read" data-read-session="${esc(s.sessionId)}" data-read-title="${esc(wt.name)}">Lire ⤢</button></div>`);
  }
  if (s.live && s.status !== 'working') parts.push(`<form class="quick" data-quick="${esc(s.sessionId)}"><input name="q" placeholder="${st === 'needs_input' ? 'Répondre à Claude…' : 'Message rapide à Claude…'}" autocomplete="off" aria-label="Message rapide à Claude"></form>`);
  return parts.join('');
}

function cardActions(wt) {
  const actions = [];
  const serving = state.app?.serving;
  if (!isBase(wt) && state.pr?.enabled) {
    if (wt.pr?.state === 'OPEN' && wt.ahead) actions.push(`<button class="btn" data-push="${esc(wt.path)}">Pousser ${wt.ahead} commit${wt.ahead > 1 ? 's' : ''}</button>`);
    else if (wt.pr?.state !== 'OPEN' && wt.pr?.state !== 'MERGED' && (wt.ahead || !wt.upstream) && wt.lastCommit) actions.push(`<button class="btn" data-pr="${esc(wt.path)}">Pousser et ouvrir la PR</button>`);
  }
  if (state.app && canServe(wt) && wt.headSha && serving?.name !== wt.name) actions.push(`<button class="btn" data-serve="${esc(wt.path)}" title="Relance l'app sur le dernier commit de ce worktree">Servir l'app</button>`);
  if (!wt.mainCheckout && !wt.locked) {
    actions.push(`<button class="btn ${wt.pr?.state === 'MERGED' ? 'primary' : ''}" data-archive="${esc(wt.path)}" title="Retire le worktree en gardant la branche et la session">Archiver</button>`);
    actions.push(`<button class="card-close" data-close="${esc(wt.path)}" title="Fermer ce worktree">Fermer</button>`);
  }
  return actions.length ? `<div class="card-actions">${actions.join('')}</div>` : '';
}

function parallelRow(wt) {
  const folded = sessionPicker(wt.sessions, state.orchestrations, null, false);
  const live = liveSessions(wt).filter((s) => !folded.agents.includes(s) || s.status === 'needs_input');
  if (live.length < 2) return '';
  const label = (s) => (s.status === 'needs_input' ? 'attend' : s.status === 'working' || backgroundOnly(s) ? 'en cours' : 'terminée');
  const kind = (s) => (s.status === 'needs_input' ? 'needs_input' : s.status === 'working' || backgroundOnly(s) ? 'working' : 'done');
  return `<div class="parallel-row" title="Sessions Claude qui travaillent en parallèle dans ce worktree">${live.map((s) => `<button class="parallel-pill ${kind(s)}" data-open-session="${esc(s.sessionId)}" title="${esc(s.task || 'Session sans prompt')}"><span class="dot"></span><span class="parallel-task">${esc((s.lastPrompt || s.task || 'Session').slice(0, 34))}</span><span class="parallel-state">${label(s)}</span></button>`).join('')}</div>`;
}

function cardMeta(wt, s, st) {
  const meta = reviewChips(wt);
  const ctx = s?.usage?.context?.usedPercentage;
  if (state.app?.serving?.name === wt.name) meta.push('<span class="chip served" title="L\'app tourne sur le dernier commit de ce worktree">▶ app servie</span>');
  const queued = wt.sessions.reduce((n, x) => n + (x.queue?.length || 0), 0);
  if (queued) meta.push(`<span class="chip queued">⏳ ${queued} en file</span>`);
  if (wt.parent) meta.push(`<span class="chip link" title="Session déléguée depuis ${esc(wt.parent.parentWorktree)}">← ${esc(wt.parent.parentWorktree)}</span>`);
  if (wt.children?.length) meta.push(`<span class="chip link" title="${esc(wt.children.map((c) => `${c.name} : ${STATUS[c.status]?.label || c.status}`).join('\n'))}">→ ${wt.children.length} déléguée${wt.children.length > 1 ? 's' : ''}</span>`);
  if (ctx != null && level(ctx)) meta.push(`<span class="chip ctx-${level(ctx)}" title="Fenêtre de contexte de la session${level(ctx) === 'crit' ? ' : pense à /compact' : ''}">Contexte : ${Math.max(0, 100 - Math.round(ctx))} % restants</span>`);
  if (wt.sessions.some((x) => x.live)) meta.push('<span class="chip live">⌨ pilotable</span>');
  if (wt.overlap?.length) meta.push(`<span class="chip parallel-warn" title="Fichiers modifiés par plusieurs sessions :\n${esc(wt.overlap.map((o) => o.file).join('\n'))}">⚠ ${wt.overlap.length} fichier${wt.overlap.length > 1 ? 's' : ''} en commun</span>`);
  if (wt.files.length) meta.push(`<span class="chip">✎ ${wt.files.length} fichier${wt.files.length > 1 ? 's' : ''}</span>`);
  if (wt.added || wt.deleted) meta.push(`<span class="chip"><span class="plus">+${wt.added}</span> <span class="minus">−${wt.deleted}</span></span>`);
  if (wt.ahead) meta.push(`<span class="chip">↑ ${wt.ahead} non poussé${wt.ahead > 1 ? 's' : ''}</span>`);
  if (wt.behind) meta.push(`<span class="chip">↓ ${wt.behind}</span>`);
  if (wt.staged) meta.push(`<span class="chip" title="Changements indexés, masqués dans Changements">● ${wt.staged} indexé${wt.staged > 1 ? 's' : ''}</span>`);
  if (!wt.files.length && !wt.staged && !wt.ahead) meta.push('<span class="chip">✓ propre</span>');
  if (wt.locked) meta.push('<span class="chip">🔒 verrouillé</span>');
  const worked = workedTime(s, st);
  if (worked >= 60000) meta.push(`<span class="chip" title="Temps de travail de Claude sur cette session, attentes exclues">⏱ ${span(worked)}</span>`);
  return meta;
}

function card(wt) {
  const st = sessionStatus(wt);
  const s = primarySession(wt);
  const last = s?.actions?.[0];
  const meta = cardMeta(wt, s, st);
  const pinned = pins.has(wt.path);
  return `<div class="card ${st} ${st === 'done' && turnRead(wt) ? 'read' : ''} ${selected === wt.path ? 'selected' : ''} ${freshDone.has(wt.path) && st === 'done' ? 'fresh' : ''}" data-path="${esc(wt.path)}">
    <div class="top">
      ${selecting ? `<input type="checkbox" class="pick" data-pick="${esc(wt.path)}" ${picked.has(wt.path) ? 'checked' : ''} aria-label="Sélectionner ${esc(wt.name)}">` : ''}
      <div><div class="name">${esc(wt.label || wt.name)}</div><div class="branch-row">${wt.otherRepo ? `<span class="repo-chip" title="${esc(wt.repo)}">${esc(wt.repoName)}</span>` : ''}${branchChip(wt)}${prChip(wt.pr)}${extChips(wt)}</div></div>
      <span class="badge ${st}"><span class="dot"></span>${s ? statusLabel(s, st, STATUS) : STATUS[st].label}${s ? ` · ${statusAge(s, st)}` : ''}</span>
      <button class="pin ${pinned ? 'on' : ''}" data-pin="${esc(wt.path)}" title="${pinned ? 'Désépingler' : 'Épingler'}">${pinned ? '★' : '☆'}</button>
    </div>
    ${s?.task ? `<div class="task">${esc(s.task)}</div>` : ''}
    ${st === 'needs_input' && s.message ? `<div class="message">${esc(s.message)}${s.updatedAt ? ` · depuis ${ago(s.statusSince || s.updatedAt)}` : ''}</div>` : ''}
    ${st === 'working' && last && !backgroundOnly(s) ? `<div class="action"><span class="tool">${esc(last.tool)}</span><span class="detail">${esc(last.detail)}</span></div>` : ''}
    ${parallelRow(wt)}
    ${agentsStrip(wt, 'card')}
    ${quickBlock(wt, s, st)}
    <div class="meta">${meta.join('')}</div>
    ${cardActions(wt)}
    ${wt.lastCommit ? `<div class="commit">${esc(wt.lastCommit.subject)} · ${ago(wt.lastCommit.at)}</div>` : ''}
  </div>`;
}

function archivesSection() {
  const rows = state.archives.map((a) => `<div class="archive-row">
      <div class="grow"><b>${esc(a.name)}</b> · ⎇ ${esc(a.branch || a.head?.slice(0, 7) || '?')} · archivé il y a ${ago(a.archivedAt)}${a.sessions?.[0]?.task ? `<div class="hint">${esc(a.sessions[0].task)}</div>` : ''}</div>
      ${a.pr ? `<a class="chip pr ${a.pr.state === 'MERGED' ? 'pr-merged' : 'pr-open'}" href="${esc(a.pr.url)}" target="_blank" rel="noopener">#${a.pr.number}</a>` : ''}
      <button class="btn" data-unarchive="${esc(a.path)}">Restaurer</button>
      ${a.sessions?.length ? `<button class="btn primary" data-unarchive="${esc(a.path)}" data-resume="1">Restaurer et reprendre</button>` : ''}
    </div>`).join('');
  return `<section class="grid-section"><details class="archives" ${archivesOpen ? 'open' : ''}><summary>Archivées <span class="count">${state.archives.length}</span></summary><div class="archive-list">${rows}</div></details></section>`;
}

function renderGrid() {
  const visible = boardWorktrees(shownWorktrees());
  const list = sorted(filter === 'active' ? visible.filter(isActive) : visible);
  const standard = list.filter((w) => !w.review);
  const reviews = list.filter((w) => w.review);
  const empty = '<div class="empty">Aucun worktree actif</div>';
  const section = (title, count, body) => `<section class="grid-section"><h2>${title}${count === null ? '' : `<span class="count">${count}</span>`}</h2><div class="cards">${body}</div></section>`;
  const parts = [`<div class="tools-strip">${shellCard()}${usageCard()}</div>`];
  if (order === 'state') {
    const byPinThenActivity = (a, b) => pins.has(b.path) - pins.has(a.path) || lastActivity(b) - lastActivity(a);
    const columns = [
      ['needs', 'À toi de jouer', 'Claude attend une réponse ou une permission.', (w) => sessionStatus(w) === 'needs_input'],
      ['working', 'En cours', 'Claude travaille.', (w) => sessionStatus(w) === 'working'],
      ['review', 'À relire', 'Tour terminé avec des changements, des commits ou une PR ouverte.', (w) => sessionStatus(w) === 'done' && !turnRead(w) && (w.files.length || w.ahead || w.pr?.state === 'OPEN')],
      ['read', 'Lu', 'Tour terminé que tu as déjà ouvert.', (w) => sessionStatus(w) === 'done' && turnRead(w) && (w.files.length || w.ahead || w.pr?.state === 'OPEN')],
      ['rest', 'Au repos', 'Rien en attente.', () => true],
    ];
    const left = [...standard];
    const html = columns.map(([cls, title, hint, test]) => {
      const items = left.filter(test).sort(byPinThenActivity);
      items.forEach((w) => left.splice(left.indexOf(w), 1));
      return `<div class="column ${cls}"><h2>${title}<span class="count">${items.length}</span></h2><p>${hint}</p>${items.length ? items.map(card).join('') : '<div class="empty-col">Rien ici</div>'}</div>`;
    }).join('');
    parts.push(`<section class="grid-section"><h2>Worktrees<span class="count">${standard.length}</span></h2><div class="kanban">${html}</div></section>`);
  } else {
    const ordered = [...standard.filter((w) => pins.has(w.path)), ...standard.filter((w) => !pins.has(w.path))];
    parts.push(section('Worktrees', standard.length, ordered.length ? ordered.map(card).join('') : empty));
  }
  if (reviews.length) parts.push(section('Reviews', reviews.length, reviews.map(card).join('')));
  if (state.archives?.length) parts.push(archivesSection());

  const drafts = {};
  document.querySelectorAll('#grid form.quick input').forEach((i) => { if (i.value) drafts[i.closest('form').dataset.quick] = i.value; });
  const active = document.activeElement?.closest?.('#grid form.quick') ? { id: document.activeElement.closest('form').dataset.quick, start: document.activeElement.selectionStart } : null;
  $('grid').innerHTML = parts.join('');
  for (const [id, value] of Object.entries(drafts)) {
    const input = document.querySelector(`#grid form.quick[data-quick="${CSS.escape(id)}"] input`);
    if (input) input.value = value;
  }
  if (active) {
    const input = document.querySelector(`#grid form.quick[data-quick="${CSS.escape(active.id)}"] input`);
    if (input) { input.focus(); input.setSelectionRange(active.start, active.start); }
  }
  if (focusIndex >= 0) document.querySelectorAll('#grid .card')[focusIndex]?.classList.add('focused');
  document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.filter === filter));
  document.querySelectorAll('#order-seg button').forEach((b) => b.classList.toggle('on', b.dataset.order === order));
  const finished = finishedBoardCount();
  $('finished-toggle').hidden = !finished;
  $('finished-toggle').textContent = finishedWorktreeLabel(finished);
  $('selection-bar').hidden = !selecting;
  $('selection-count').textContent = `${picked.size} sélectionnée${picked.size > 1 ? 's' : ''}`;
  renderQueue();
}

$('grid').addEventListener('click', async (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { e.stopPropagation(); openClose(closeBtn.dataset.close); return; }
  const t = e.target;
  if (t.closest('form.quick')) return;
  const pin = t.closest('[data-pin]');
  if (pin) {
    pins.has(pin.dataset.pin) ? pins.delete(pin.dataset.pin) : pins.add(pin.dataset.pin);
    localSet('pins', JSON.stringify([...pins]));
    renderGrid();
    return;
  }
  const pick = t.closest('[data-pick]');
  if (pick) { pick.checked ? picked.add(pick.dataset.pick) : picked.delete(pick.dataset.pick); renderGrid(); return; }
  const quickKey = t.closest('[data-quick-key]');
  if (quickKey) {
    const result = await post('/api/keys', { target: quickKey.dataset.session, ops: [{ literal: quickKey.dataset.quickKey }] });
    toast(result.ok ? `Touche ${quickKey.dataset.quickKey} envoyée.` : result.data.error || 'Envoi impossible.', result.ok ? '' : 'error');
    setTimeout(refresh, 800);
    return;
  }
  const readSession = t.closest('[data-read-session]');
  if (readSession) { openReaderFor(readSession.dataset.readSession, readSession.dataset.readTitle); return; }
  const peek = t.closest('[data-peek]');
  if (peek) { openPeeks.has(peek.dataset.peek) ? openPeeks.delete(peek.dataset.peek) : openPeeks.add(peek.dataset.peek); peek.classList.toggle('open'); return; }
  const prBtn = t.closest('[data-pr]');
  if (prBtn) { openPrDialog(prBtn.dataset.pr); return; }
  const pushBtn = t.closest('[data-push]');
  if (pushBtn) { pushCommits(pushBtn.dataset.push); return; }
  const serveBtn = t.closest('[data-serve]');
  if (serveBtn) { serveApp(serveBtn.dataset.serve); return; }
  const archiveBtn = t.closest('[data-archive]');
  if (archiveBtn) { archive(archiveBtn.dataset.archive); return; }
  const unarchiveBtn = t.closest('[data-unarchive]');
  if (unarchiveBtn) { unarchive(unarchiveBtn.dataset.unarchive, !!unarchiveBtn.dataset.resume); return; }
  if (t.closest('.archives summary')) { setTimeout(() => { archivesOpen = !!document.querySelector('#grid .archives')?.open; }, 0); return; }
  const openSession = t.closest('[data-open-session]');
  if (openSession) {
    select(openSession.closest('.card').dataset.path);
    tab = 'chat'; renderTabs();
    chatSession = openSession.dataset.openSession; chatBarSignature = null;
    renderPanel(); loadChat(true);
    return;
  }
  if (t.closest('a')) return;
  const c = t.closest('.card, .tool-pill');
  if (!c) return;
  select(c.dataset.shell ? SHELL : c.dataset.usage ? USAGE : c.dataset.path);
});

$('grid').addEventListener('submit', async (e) => {
  const form = e.target.closest('form.quick');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  const result = await post('/api/message', { target: form.dataset.quick, text });
  input.disabled = false;
  if (!result.ok) { toast(result.data.error || 'Envoi impossible.', 'error'); return; }
  input.value = '';
  toast(SENT_NOTE[result.data.route] || 'Message envoyé à Claude.');
  setTimeout(refresh, 900);
});

$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = b.dataset.filter; localSet('filter', filter); renderGrid();
});

function setOrder(value) {
  order = value;
  localSet('order', order);
  renderGrid();
}

$('order-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-order]'); if (b) setOrder(b.dataset.order); });
