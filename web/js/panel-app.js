const APP_STATUS = {
  stopped: { label: "Lancer l'app", hint: "L'app ne tourne pas. Clique pour lancer le build à la racine du repo." },
  building: { label: 'Build en cours', hint: 'Build en cours dans tmux (cw-app). Clique pour suivre les logs.' },
  starting: { label: 'Démarrage', hint: 'Build terminé, les process démarrent. Clique pour le détail.' },
  up: { label: 'App up', hint: "L'app répond. Clique pour le détail." },
  degraded: { label: 'App up · alertes', hint: "L'app répond, mais des process ont un problème. Clique pour le détail." },
  ko: { label: 'App KO', hint: "Le build ou un process a échoué. Clique pour voir les logs et relancer." },
};

function appButton() {
  if (!state.app) return '';
  const app = state.app;
  const meta = APP_STATUS[app.state] || APP_STATUS.stopped;
  const elapsed = app.state === 'building' && app.build ? ` · ${duration(Date.now() - app.build.startedAt)}` : '';
  return `<button class="app-btn ${esc(app.state)}" id="app-btn" title="${esc(app.reason || meta.hint)}"><span class="dot"></span>${meta.label}${elapsed}</button>`;
}

function appPane() {
  if (!state.app) return '';
  const app = state.app;
  const main = state.worktrees.find((w) => w.name === 'main');
  const online = app.processes.filter((p) => p.status === 'online').length;
  const lines = [];
  if (app.state === 'degraded') (app.warnings || []).forEach((w) => lines.push(`<div class="reason warn">${esc(w)}</div>`));
  else if (app.reason) lines.push(`<div class="reason">${esc(app.reason)}</div>`);
  if (app.processes.length) lines.push(`<div>pm2 : ${online}/${app.processes.length} process en ligne</div>`);
  if (app.recoveryDoc && ['ko', 'degraded'].includes(app.state)) lines.push(`<div>Dépannage : <code>${esc(app.recoveryDoc)}</code></div>`);
  if (app.build?.lastLine && app.state === 'building') lines.push(`<div class="last">${esc(app.build.lastLine)}</div>`);
  const running = app.state !== 'stopped';
  const actions = [
    app.state === 'building' ? '' : `<button class="btn primary" data-app="${running ? 'restart' : 'start'}">${running ? 'Relancer' : 'Lancer'}</button>`,
    running ? '<button class="btn" data-app="stop">Arrêter</button>' : '',
    ['up', 'degraded', 'starting'].includes(app.state) ? `<a href="${esc(app.link)}" target="_blank" rel="noopener">Ouvrir l'app ↗</a>` : '',
  ].join('');
  return `<div class="app-info">
      ${app.serving
        ? `<div class="branch">App servie depuis le worktree <b>${esc(app.serving.name)}</b> · ⎇ ${esc(app.serving.branch || '?')} @ ${esc(String(app.serving.sha).slice(0, 7))} (commit, sans les changements non commités) <button class="btn" data-app="unserve">Revenir au checkout principal</button></div>`
        : `<div class="branch">App lancée depuis ${esc(state.repo)} · branche ${esc(main ? branchLabel(main) : '?')}</div>`}
      ${!app.serving && currentWt() && currentWt().name !== 'main' && main && branchLabel(currentWt()) !== branchLabel(main) ? `<div class="reason warn">Ce worktree est sur ⎇ ${esc(branchLabel(currentWt()))} : l'app sert ⎇ ${esc(branchLabel(main))}, pas ce worktree. <button class="btn" data-serve="${esc(currentWt().path)}">Servir ce worktree</button></div>` : ''}
      ${lines.join('')}<div class="app-actions">${actions}</div>
    </div>`;
}

async function appAction(action) {
  if (action === 'unserve') {
    if (!confirm("Remettre le checkout principal sur sa branche d'origine et relancer l'app ?")) return;
    const result = await post('/api/app/unserve', {});
    toast(result.ok ? "Checkout principal restauré, l'app redémarre." : result.data.error || 'Action impossible.', result.ok ? '' : 'error');
    setTimeout(refresh, 800);
    return;
  }
  if (action === 'stop' && !confirm(`Arrêter l'app${state.app?.usesPm2 ? ' (pm2 delete all)' : ''} ?`)) return;
  const result = await post(action === 'stop' ? '/api/app/stop' : '/api/app/start', { restart: action === 'restart' });
  if (!result.ok) { toast(result.data.error || 'Action impossible.', 'error'); return; }
  toast(action === 'stop' ? 'App arrêtée.' : 'Build lancé à la racine du repo.');
  setTimeout(refresh, 800);
}

async function serveApp(wtPath) {
  const wt = state.worktrees.find((w) => w.path === wtPath);
  if (!wt) return;
  if (!confirm(`Servir l'app depuis ${wt.name} ?\n\nLe checkout principal passe sur le commit ${wt.head} (HEAD détachée) et l'app redémarre. Les changements non commités de ${wt.name} ne sont pas inclus. « Revenir au checkout principal » dans l'onglet App remet tout en place.`)) return;
  const result = await post('/api/app/serve', { path: wtPath });
  toast(result.ok ? `L'app redémarre sur ${wt.name}.` : result.data.error || 'Bascule impossible.', result.ok ? '' : 'error');
  refresh();
}
