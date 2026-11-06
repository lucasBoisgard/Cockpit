// AI connections of the Connections page: Claude and GPT (Codex) sign-in state, and a guided sign-in that
// works from a container without a browser (link and one-time code shown here, Claude's code pasted here).
const connUi = { status: null, flow: {}, busy: {}, timer: null, setup: null, setupTimer: null };

async function loadConnections() {
  const res = await api('/api/connect').catch(() => null);
  if (!res?.ok) return;
  const before = connUi.status;
  connUi.status = await res.json();
  for (const id of ['claude', 'codex']) {
    if (connUi.flow[id] && connUi.status[id].loggedIn && !(before?.[id]?.loggedIn && connUi.flow[id].relogin)) {
      connUi.flow[id] = null;
      toast(`${id === 'codex' ? 'GPT' : 'Claude'} est connecté.`);
      if (typeof loadProviders === 'function') loadProviders();
    }
  }
  renderConnections();
  clearTimeout(connUi.timer);
  if ($('mcp-dialog').open && (connUi.flow.codex?.url || connUi.flow.claude?.url)) connUi.timer = setTimeout(loadConnections, 3000);
}

function connCard(id) {
  const s = connUi.status?.[id];
  const flow = connUi.flow[id];
  const name = id === 'codex' ? 'GPT' : 'Claude';
  const sub = id === 'codex' ? 'via Codex CLI · modèles GPT d’OpenAI' : 'via Claude Code · modèles Claude';
  if (!s) return `<div class="conn-card"><b>${name}</b><span class="conn-muted">Lecture…</span></div>`;
  const ok = s.loggedIn;
  const state = ok
    ? `<span class="conn-state is-ok"><i></i>Connecté${s.email ? ` · ${esc(s.email)}` : ''}${s.method ? ` · ${esc(s.method)}` : ''}</span>${s.expiresAt ? `<span class="conn-muted">expire le ${new Date(s.expiresAt).toLocaleDateString('fr-FR')}</span>` : ''}`
    : id === 'codex' && !s.installed ? '<span class="conn-state is-off"><i></i>Codex CLI non installé</span>' : '<span class="conn-state is-off"><i></i>Non connecté</span>';
  let body = '';
  if (flow?.url && id === 'codex') {
    body = `<div class="conn-flow"><p>1. Ouvre <a href="${esc(flow.url)}" target="_blank" rel="noopener">${esc(flow.url)}</a> et connecte-toi à ton compte ChatGPT.</p>
      <p>2. Saisis ce code (valable 15 min) :</p><div class="conn-code">${esc(flow.code)}<button class="btn" data-conn-copy="${esc(flow.code)}">Copier</button></div>
      <p class="conn-muted"><span class="conn-wait"></span>En attente de ta validation…</p><button class="btn" data-conn-cancel="codex">Annuler</button></div>`;
  } else if (flow?.url && id === 'claude') {
    body = `<form class="conn-flow" data-conn-claude-code><p>1. Ouvre <a href="${esc(flow.url)}" target="_blank" rel="noopener">le lien de connexion Claude</a> et autorise l’accès.</p>
      <p>2. Colle ici le code affiché à la fin :</p><div class="conn-row"><input name="code" autocomplete="off" spellcheck="false" placeholder="Code d’autorisation" required><button class="btn primary" ${connUi.busy.claude ? 'disabled' : ''}>Valider</button></div>
      <button type="button" class="btn" data-conn-cancel="claude">Annuler</button></form>`;
  } else if (flow?.key) {
    body = `<form class="conn-flow" data-conn-key><p>Colle une clé d’API OpenAI (elle est transmise à Codex, le cockpit ne la garde pas).</p>
      <div class="conn-row"><input name="key" type="password" autocomplete="off" placeholder="sk-…" required><button class="btn primary" ${connUi.busy.codex ? 'disabled' : ''}>Connecter</button></div>
      <button type="button" class="btn" data-conn-back="codex">Retour</button></form>`;
  } else if (id === 'codex' && s.installed) {
    body = `<div class="conn-actions"><button class="btn ${ok ? '' : 'primary'}" data-conn-start="codex" ${connUi.busy.codex ? 'disabled' : ''}>${ok ? 'Reconnecter' : 'Se connecter avec ChatGPT'}</button><button class="btn" data-conn-keyform>${ok ? 'Utiliser une clé d’API' : 'Avec une clé d’API'}</button></div>`;
  } else if (id === 'codex') {
    body = '<p class="conn-muted">Installe-le dans le conteneur : <code>npm install -g @openai/codex</code>, puis reviens ici.</p>';
  } else {
    body = `<div class="conn-actions"><button class="btn ${ok ? '' : 'primary'}" data-conn-start="claude" ${connUi.busy.claude ? 'disabled' : ''}>${ok ? 'Reconnecter' : 'Se connecter'}</button><button class="btn" data-conn-start="claude" data-console="1">Avec la console Anthropic</button></div>`;
  }
  const setup = id === 'codex' && ok ? setupBlock() : '';
  return `<div class="conn-card ${ok ? 'is-ok' : ''}"><div class="conn-title"><b>${name}</b><span class="conn-muted">${sub}</span></div><div class="conn-line">${state}</div>${body}${setup}</div>`;
}

// Codex asks once per repository to trust the folder and the cockpit's hook: done here, through its own screens.
function setupBlock() {
  const st = connUi.setup;
  const repos = connUi.status?.repos || [];
  if (!st) {
    return `<div class="conn-flow"><p><b>Autoriser GPT sur un dépôt</b> <span class="conn-muted">une fois par dépôt : confiance du dossier et hook du cockpit, validés dans Codex</span></p>
      <div class="conn-row"><select id="conn-repo">${repos.map((r) => `<option value="${esc(r)}">${esc(r.split('/').pop())} · ${esc(r)}</option>`).join('')}</select><button class="btn primary" data-conn-setup ${connUi.busy.setup ? 'disabled' : ''}>Autoriser</button></div></div>`;
  }
  if (st.ready) return `<div class="conn-flow"><p class="conn-ready">GPT est prêt sur ${esc(st.repo.split('/').pop())}.</p><button class="btn" data-conn-setup-close>OK</button></div>`;
  const p = st.prompt;
  const inner = p
    ? `<pre class="ask-screen">${esc(p.text)}</pre><div class="conn-actions">${p.options.map((o) => `<button class="btn ${o.n === p.selected ? 'primary' : ''}" data-conn-screen="${o.n}">${esc(o.label)}</button>`).join('')}</div>`
    : st.answered ? `<p>GPT a répondu mais le cockpit ne reçoit pas son état : ses hooks ne sont pas validés dans Codex.</p><div class="conn-actions"><button class="btn primary" data-conn-hooks>Ouvrir la revue des hooks dans le terminal</button></div>` : '<p class="conn-muted"><span class="conn-wait"></span>GPT démarre et répond à une mini-demande de test…</p>';
  return `<div class="conn-flow"><p><b>${esc(st.repo.split('/').pop())}</b> : réponds à Codex (ton choix lui est envoyé tel quel).</p>${inner}<button class="btn" data-conn-setup-cancel>Annuler</button></div>`;
}

async function pollSetup() {
  clearTimeout(connUi.setupTimer);
  const st = connUi.setup;
  if (!st || st.ready) return;
  const res = await api(`/api/connect/codex/setup?tmux=${encodeURIComponent(st.tmux)}`).catch(() => null);
  const data = res?.ok ? await res.json() : null;
  if (!connUi.setup) return;
  if (data?.attached) {
    connUi.setup.ready = true;
    post('/api/connect/codex/setup/end', { tmux: st.tmux });
  } else if (data?.done) {
    connUi.setup = null;
    toast('La session Codex s’est fermée avant la fin : relance l’autorisation.', 'error');
  } else if (data) {
    connUi.setup.prompt = data.prompt;
    connUi.setup.answered = !data.prompt && data.answered;
  }
  renderConnections();
  if (connUi.setup && !connUi.setup.ready && $('mcp-dialog').open) connUi.setupTimer = setTimeout(pollSetup, 2000);
}

function renderConnections() {
  const box = $('conn-ai');
  const focused = document.activeElement?.closest?.('#conn-ai') ? document.activeElement.name : null;
  const draft = box.querySelector('input[name="code"]')?.value || '';
  box.innerHTML = `<h3 class="conn-section">IA</h3><div class="conn-cards">${connCard('claude')}${connCard('codex')}</div>`;
  const code = box.querySelector('input[name="code"]');
  if (code) code.value = draft;
  if (focused) box.querySelector(`input[name="${focused}"]`)?.focus();
}

async function connStart(id, useConsole) {
  connUi.busy[id] = true;
  renderConnections();
  const result = await post(id === 'codex' ? '/api/connect/codex/device' : '/api/connect/claude', { console: !!useConsole });
  connUi.busy[id] = false;
  if (!result.ok) { toast(result.data.error || 'Connexion impossible.', 'error'); renderConnections(); return; }
  connUi.flow[id] = { url: result.data.url, code: result.data.code, relogin: !!connUi.status?.[id]?.loggedIn };
  renderConnections();
  loadConnections();
  if (id === 'claude') $('conn-ai').querySelector('input[name="code"]')?.focus();
}

$('conn-ai').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-conn-setup]')) {
    const repo = $('conn-repo').value;
    connUi.busy.setup = true;
    renderConnections();
    const result = await post('/api/connect/codex/setup', { repo });
    connUi.busy.setup = false;
    if (!result.ok) { toast(result.data.error || 'Lancement impossible.', 'error'); renderConnections(); return; }
    connUi.setup = { repo, tmux: result.data.tmux, prompt: result.data.prompt, since: Date.now() };
    renderConnections();
    pollSetup();
    return;
  }
  const screenBtn = t.closest('[data-conn-screen]');
  if (screenBtn && connUi.setup) {
    const r = await post('/api/codex/screen', { tmux: connUi.setup.tmux, option: Number(screenBtn.dataset.connScreen) });
    if (!r.ok) toast(r.data.error || 'Envoi impossible.', 'error');
    connUi.setup.prompt = r.data?.next || null;
    connUi.setup.since = Date.now();
    renderConnections();
    pollSetup();
    return;
  }
  if (t.closest('[data-conn-hooks]') && connUi.setup) {
    const r = await post('/api/codex/hooks', { tmux: connUi.setup.tmux });
    if (!r.ok) { toast(r.data.error || 'Ouverture impossible.', 'error'); return; }
    $('mcp-dialog').close();
    openCodexTerminal(connUi.setup.tmux);
    return;
  }
  if (t.closest('[data-conn-setup-cancel]') && connUi.setup) { await post('/api/connect/codex/setup/end', { tmux: connUi.setup.tmux }); connUi.setup = null; renderConnections(); return; }
  if (t.closest('[data-conn-setup-close]')) { connUi.setup = null; renderConnections(); return; }
  const start = t.closest('[data-conn-start]');
  if (start) { connStart(start.dataset.connStart, start.dataset.console); return; }
  if (t.closest('[data-conn-keyform]')) { connUi.flow.codex = { key: true }; renderConnections(); $('conn-ai').querySelector('input[name="key"]')?.focus(); return; }
  const back = t.closest('[data-conn-back]');
  if (back) { connUi.flow[back.dataset.connBack] = null; renderConnections(); return; }
  const cancel = t.closest('[data-conn-cancel]');
  if (cancel) { await post('/api/connect/cancel', { id: cancel.dataset.connCancel }); connUi.flow[cancel.dataset.connCancel] = null; renderConnections(); return; }
  const copy = t.closest('[data-conn-copy]');
  if (copy) { copyText(copy.dataset.connCopy).then((ok) => toast(ok ? 'Code copié.' : 'Copie impossible.', ok ? '' : 'error')); }
});

$('conn-ai').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.matches('[data-conn-key]')) {
    connUi.busy.codex = true;
    renderConnections();
    const result = await post('/api/connect/codex/key', { key: form.elements.key?.value || '' });
    connUi.busy.codex = false;
    if (!result.ok) { toast(result.data.error || 'Connexion refusée.', 'error'); renderConnections(); return; }
    connUi.flow.codex = null;
    toast('GPT est connecté.');
    if (typeof loadProviders === 'function') loadProviders();
    loadConnections();
    return;
  }
  if (form.matches('[data-conn-claude-code]')) {
    connUi.busy.claude = true;
    renderConnections();
    const result = await post('/api/connect/claude/code', { code: form.elements.code.value });
    connUi.busy.claude = false;
    if (!result.ok) { toast(result.data.error || 'Code refusé.', 'error'); renderConnections(); return; }
    connUi.flow.claude = null;
    toast('Claude est connecté.');
    loadConnections();
  }
});
