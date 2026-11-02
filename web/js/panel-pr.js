const CHECK_LABEL = { failing: 'ÉCHEC', pending: 'EN COURS', passing: 'OK' };
const REVIEW_LABEL = { APPROVED: 'Approuvée', CHANGES_REQUESTED: 'Changements demandés', REVIEW_REQUIRED: 'Review requise' };

async function loadChecks() {
  const wt = currentWt();
  if (!wt) return;
  checksLoadedAt = Date.now();
  if (!$('checks').innerHTML) $('checks').innerHTML = '<div class="placeholder">Chargement de la PR…</div>';
  const res = await api(`/api/checks?wt=${encodeURIComponent(wt.path)}`).catch(() => null);
  if (currentWt()?.path !== wt.path) return;
  const data = res?.ok ? await res.json() : null;
  if (!data) { $('checks').innerHTML = '<div class="placeholder">Impossible de lire la PR (gh absent ou non connecté).</div>'; return; }
  if (data.none) {
    $('checks').innerHTML = `<div class="placeholder">Pas de PR pour ⎇ ${esc(wt.branch)}.<br><br><button class="btn primary" data-pr="${esc(wt.path)}">Pousser et ouvrir la PR</button></div>`;
    return;
  }
  const blockers = [
    data.failing && `${data.failing} check${data.failing > 1 ? 's' : ''} en échec`,
    data.pending && `${data.pending} check${data.pending > 1 ? 's' : ''} en cours`,
    data.review !== 'APPROVED' && (REVIEW_LABEL[data.review] || 'Review attendue'),
    data.mergeable === 'CONFLICTING' && 'Conflits avec la base',
    data.draft && 'PR en draft',
  ].filter(Boolean);
  const open = data.state === 'OPEN';
  const duration = (c) => (c.startedAt && c.completedAt ? ` · ${Math.max(1, Math.round((Date.parse(c.completedAt) - Date.parse(c.startedAt)) / 1000))} s` : '');
  const checks = [...data.checks].sort((a, b) => ['failing', 'pending', 'passing'].indexOf(a.state) - ['failing', 'pending', 'passing'].indexOf(b.state));
  $('checks').innerHTML = `
    <div class="report-head"><div class="pr"><a href="${esc(data.url)}" target="_blank" rel="noopener">#${data.number} · ${esc(data.title)} ↗</a></div>
      <div class="sub">${esc(data.head || '')} → ${esc(data.base || '')} · ${esc(data.state)}${data.review ? ` · ${esc(REVIEW_LABEL[data.review] || data.review)}` : ''}</div></div>
    ${open ? `<div class="ready ${blockers.length ? 'no' : ''}">${blockers.length ? `Pas encore prête : ${esc(blockers.join(' · '))}` : 'Prête à merger'}</div>` : ''}
    ${currentWt()?.ahead ? `<div class="card-actions"><button class="btn" data-push="${esc(wt.path)}">Pousser ${currentWt().ahead} commit${currentWt().ahead > 1 ? 's' : ''} non poussé${currentWt().ahead > 1 ? 's' : ''}</button></div>` : ''}
    <section><h3 class="sub-title">Checks (${data.checks.length})</h3>
      ${checks.map((c) => `<div class="check-row"><span class="state ${c.state}">${CHECK_LABEL[c.state]}</span><span class="grow">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}${duration(c)}</span>${c.state === 'failing' ? `<button class="btn" data-sendcheck="${esc(c.name)}">Envoyer l'échec à Claude</button>` : ''}</div>`).join('') || '<p class="hint">Aucun check.</p>'}
    </section>
    ${data.reviews?.length ? `<section><h3 class="sub-title">Reviews</h3>${data.reviews.map((r) => `<div class="check-row"><span class="state ${r.state === 'APPROVED' ? 'passing' : r.state === 'CHANGES_REQUESTED' ? 'failing' : 'pending'}">${esc(r.state)}</span><span class="grow"><b>${esc(r.author)}</b> ${esc(r.body)}</span></div>`).join('')}</section>` : ''}`;
}

async function openPrDialog(wtPath) {
  const res = await api(`/api/pr-draft?wt=${encodeURIComponent(wtPath)}`).catch(() => null);
  if (!res?.ok) { toast('Impossible de préparer la PR.', 'error'); return; }
  const draft = await res.json();
  $('pr-form').dataset.path = wtPath;
  $('pr-title').value = draft.title;
  $('pr-body').value = draft.body;
  $('pr-labels').value = draft.labels.join(', ');
  $('pr-assignee').value = draft.assignee;
  $('pr-draft').checked = false;
  $('pr-info').textContent = `⎇ ${draft.branch} → ${draft.base} · ${draft.commits.length} commit${draft.commits.length > 1 ? 's' : ''} : ${draft.commits.slice(0, 5).join(' · ')}${draft.commits.length > 5 ? '…' : ''}`;
  $('pr-dialog').showModal();
  $('pr-title').focus();
}

async function pushCommits(wtPath) {
  const wt = state.worktrees.find((w) => w.path === wtPath);
  if (!wt || !confirm(`Pousser ${wt.ahead} commit${wt.ahead > 1 ? 's' : ''} de ⎇ ${wt.branch} sur origin ?`)) return;
  const result = await post('/api/push', { path: wtPath });
  toast(result.ok ? 'Commits poussés.' : result.data.error || 'Push impossible.', result.ok ? '' : 'error');
  refresh();
}

$('panel').addEventListener('click', (e) => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn?.dataset.tab === 'checks') loadChecks();
});

$('pr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pr-submit').disabled = true;
  $('pr-submit').textContent = 'Création…';
  const result = await post('/api/pr', {
    path: $('pr-form').dataset.path,
    title: $('pr-title').value,
    body: $('pr-body').value,
    labels: $('pr-labels').value.split(',').map((l) => l.trim()).filter(Boolean),
    assignee: $('pr-assignee').value.trim(),
    draft: $('pr-draft').checked,
  });
  $('pr-submit').disabled = false;
  $('pr-submit').textContent = 'Pousser et créer la PR';
  if (!result.ok) { toast(result.data.error || 'Création impossible.', 'error'); return; }
  $('pr-dialog').close();
  const c = result.data.check;
  const problems = c ? [!c.labels && 'labels manquants', !c.assignee && 'assignee manquant', !c.footer && 'footer « Generated with Claude Code » présent'].filter(Boolean) : [];
  toast(problems.length ? `PR créée, à vérifier : ${problems.join(', ')}` : `PR créée : ${result.data.url}`, problems.length ? 'error' : '', () => window.open(result.data.url, '_blank', 'noopener'));
  refresh();
});
