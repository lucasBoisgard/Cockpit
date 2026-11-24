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

// The App session is the main checkout: it only serves the app, so the app's status lives there and nowhere else
const isAppSession = (wt) => !!state.app && !!wt?.mainCheckout && !wt.otherRepo;

// Where the running code comes from, in one line
function appSource(app) {
  const main = state.worktrees.find((w) => w.mainCheckout && !w.otherRepo);
  if (!app.serving) return `<span class="appmgr-src-label">Sert</span> la branche <b>⎇ ${esc(main ? branchLabel(main) : '?')}</b> du checkout principal`;
  const synced = app.serving.syncedAt ? ` · mis à jour ${esc(ago(app.serving.syncedAt))}` : '';
  return `<span class="appmgr-src-label">Sert</span> le worktree <b>${esc(app.serving.name)}</b> · ⎇ ${esc(app.serving.branch || '?')} @ ${esc(String(app.serving.sha || '').slice(0, 7))}${synced}`;
}

function appPane() {
  if (!state.app) return '';
  const app = state.app;
  const meta = APP_STATUS[app.state] || APP_STATUS.stopped;
  const online = app.processes.filter((p) => p.status === 'online').length;
  const notes = [];
  if (app.state === 'degraded') (app.warnings || []).forEach((w) => notes.push(`<div class="appmgr-note warn">${esc(w)}</div>`));
  else if (app.reason) notes.push(`<div class="appmgr-note bad">${esc(app.reason)}</div>`);
  if (app.recoveryDoc && ['ko', 'degraded'].includes(app.state)) notes.push(`<div class="appmgr-note">Dépannage : <code>${esc(app.recoveryDoc)}</code></div>`);
  if (app.build?.lastLine && app.state === 'building') notes.push(`<div class="appmgr-note appmgr-last">${esc(app.build.lastLine)}</div>`);
  const running = app.state !== 'stopped';
  const elapsed = app.state === 'building' && app.build ? duration(Date.now() - app.build.startedAt) : '';
  const facts = [elapsed && `build ${elapsed}`, app.processes.length && `pm2 ${online}/${app.processes.length} en ligne`].filter(Boolean).join(' · ');
  const actions = [
    ['up', 'degraded', 'starting'].includes(app.state) && app.link ? `<a class="btn primary" href="${esc(app.link)}" target="_blank" rel="noopener">Ouvrir l'app ↗</a>` : '',
    app.state === 'building' ? '' : `<button class="btn ${running ? '' : 'primary'}" data-app="${running ? 'restart' : 'start'}">${running ? 'Relancer' : 'Lancer'}</button>`,
    running ? '<button class="btn" data-app="stop">Arrêter</button>' : '',
    app.serving ? '<button class="btn" data-app="unserve" title="Remet le checkout principal sur sa branche et relance l\'app">Revenir au checkout principal</button>' : '',
  ].join('');
  return `<div class="appmgr appmgr-${esc(app.state)}">
      <div class="appmgr-top">
        <span class="appmgr-state"><span class="appmgr-dot"></span>${meta.label}</span>
        ${facts ? `<span class="appmgr-facts">${esc(facts)}</span>` : ''}
        <span class="appmgr-actions">${actions}</span>
      </div>
      <div class="appmgr-src">${appSource(app)}</div>
      ${app.serving ? '<div class="appmgr-hint">Code non commité inclus · mis à jour à chaque fin de tour de la session du worktree</div>' : ''}
      ${notes.join('')}
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
  const result = await post('/api/app/serve', { path: wtPath });
  toast(result.ok ? `L'app redémarre sur ${wt.name}${result.data.stashed ? ` · changements du checkout principal mis de côté (stash ${result.data.stashed})` : ''}.` : result.data.error || 'Bascule impossible.', result.ok ? '' : 'error');
  refresh();
}

// The App session's row in the queue carries the app's state and what it serves
function appQueueLine() {
  const app = state.app;
  const meta = APP_STATUS[app.state] || APP_STATUS.stopped;
  const what = app.serving ? `⎇ ${app.serving.branch || app.serving.name}` : 'checkout principal';
  return `<span class="appmgr-queue appmgr-${esc(app.state)}" title="${esc(app.reason || meta.hint)}"><span class="appmgr-dot"></span>${meta.label}<span class="appmgr-queue-what">${esc(what)}</span></span>`;
}
