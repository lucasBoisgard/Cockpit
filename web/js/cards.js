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
  renderTopbar();
  $('worktree-names').innerHTML = state.worktrees.filter((w) => !w.mainCheckout).map((w) => `<option value="${esc(w.name)}">`).join('');
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

function renderBoard() {
  const finished = finishedBoardCount();
  $('finished-toggle').hidden = !finished;
  $('finished-toggle').textContent = finishedWorktreeLabel(finished);
  renderQueue();
}
