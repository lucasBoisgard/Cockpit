// MCP part of the Connections page. Servers are managed for the whole cockpit: added to Claude's user scope
// and to Codex's global config, so every session of every worktree gets them. Servers a repository declares
// are listed apart and can be made global; a server known to one provider can be added to the other.
const MCP_GROUPS = [
  ['claude.ai', 'Connecteurs claude.ai', 'Gérés sur claude.ai, pour Claude'],
  ['user', 'Claude', 'Pour toutes les sessions Claude'],
  ['plugin', 'Plugins Claude', 'Apportés par un plugin'],
  ['codex', 'GPT', 'Pour toutes les sessions GPT'],
  ['repo', 'Déclarés dans un dépôt', 'Valent seulement dans ce dépôt : « Rendre global » les ajoute partout'],
];
const MCP_HEALTH = { ok: 'Connecté', auth: 'À authentifier', failed: 'En échec', pending: 'En attente d’approbation', disabled: 'Désactivé', checking: 'Vérification…', unknown: 'Non vérifié' };
const mcpUi = { data: null, adding: false, query: '', timer: null, busy: false };

async function loadMcp(refresh = false) {
  const res = await api(`/api/mcp${refresh ? '?refresh=1' : ''}`).catch(() => null);
  if (!res?.ok) { toast('Lecture des serveurs MCP impossible.', 'error'); return; }
  mcpUi.data = await res.json();
  renderMcp();
  clearTimeout(mcpUi.timer);
  if (mcpUi.data.checking && $('mcp-dialog').open) mcpUi.timer = setTimeout(() => loadMcp(false), 3000);
}

function openMcp() {
  openPage($('mcp-dialog'));
  renderConnections();
  renderMcp();
  loadConnections();
  loadMcp(false);
}

function mcpRow(s) {
  const data = mcpUi.data;
  const keys = [...(s.envKeys || []).map((k) => `<span class="mcp-key" title="Variable d’environnement (valeur masquée)">${esc(k)}</span>`), ...(s.headerKeys || []).map((k) => `<span class="mcp-key" title="En-tête (valeur masquée)">${esc(k)}</span>`)].join('');
  const both = s.inClaude && s.inCodex ? '<span class="mcp-both" title="Disponible pour Claude et pour GPT">Claude + GPT</span>' : '';
  const where = s.source === 'repo' ? `<span class="mcp-chip">${esc(s.repo)} · ${s.scope === 'project' ? '.mcp.json' : 'local'}</span>` : '';
  const actions = [
    s.health === 'auth' ? `<button class="btn" data-mcp-login="${esc(s.name)}" data-provider="${s.provider}">Se connecter</button>` : '',
    s.source === 'user' && !s.inCodex && data?.codexInstalled ? `<button class="btn" data-mcp-share="${esc(s.name)}" data-to="codex">Aussi pour GPT</button>` : '',
    s.source === 'codex' && !s.inClaude ? `<button class="btn" data-mcp-share="${esc(s.name)}" data-to="claude">Aussi pour Claude</button>` : '',
    s.source === 'repo' ? `<button class="btn" data-mcp-global="${esc(s.name)}" data-repo="${esc(s.repoPath)}" data-scope="${esc(s.scope)}">Rendre global</button>` : '',
    s.removable ? `<button class="btn mcp-remove" data-mcp-remove="${esc(s.name)}" data-provider="${s.provider}" data-scope="${esc(s.scope || '')}" data-repo="${esc(s.repoPath || '')}">Retirer</button>` : '',
  ].join('');
  return `<div class="mcp-row"><span class="mcp-dot mcp-h-${s.health}" title="${esc(s.healthText || MCP_HEALTH[s.health])}"></span>
    <div class="mcp-main"><div class="mcp-name">${esc(s.name.replace(/^claude\.ai /, ''))}<span class="mcp-chip">${esc(s.transport)}</span>${where}${both}${keys}</div><div class="mcp-target" title="${esc(s.target)}">${esc(s.target)}</div></div>
    <span class="mcp-state mcp-c-${s.health}" title="${esc(s.healthText)}">${MCP_HEALTH[s.health] || esc(s.healthText)}</span><span class="mcp-actions">${actions}</span></div>`;
}

function mcpForm() {
  const codex = mcpUi.data?.codexInstalled;
  return `<form class="mcp-form" id="mcp-form">
    <div class="mcp-grid">
      <label>Pour<select name="provider">${codex ? '<option value="both">Claude et GPT</option>' : ''}<option value="claude">Claude</option><option value="codex" ${codex ? '' : 'disabled'}>GPT</option></select></label>
      <label>Nom<input name="name" required placeholder="mon-serveur" autocomplete="off"></label>
      <label>Transport<select name="transport"><option value="stdio">Commande locale (stdio)</option><option value="http">HTTP</option><option value="sse">SSE (Claude)</option></select></label>
    </div>
    <label class="mcp-stdio">Commande<input name="command" placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp" autocomplete="off"></label>
    <label class="mcp-remote" hidden>URL<input name="url" placeholder="https://mcp.exemple.com/mcp" autocomplete="off"></label>
    <label class="mcp-stdio">Variables d’environnement <small>une par ligne, NOM=valeur</small><textarea name="env" rows="2" spellcheck="false"></textarea></label>
    <label class="mcp-remote" hidden>En-têtes <small>Claude seulement, un par ligne, Nom: valeur</small><textarea name="headers" rows="2" spellcheck="false"></textarea></label>
    <div class="mcp-buttons"><button class="btn primary" ${mcpUi.busy ? 'disabled' : ''}>${mcpUi.busy ? 'Ajout…' : 'Ajouter pour toute l’application'}</button><button type="button" class="btn" data-mcp-add>Annuler</button></div>
  </form>`;
}

function syncMcpForm() {
  const form = $('mcp-form');
  if (!form) return;
  const stdio = form.elements.transport.value === 'stdio';
  form.querySelectorAll('.mcp-stdio').forEach((el) => { el.hidden = !stdio; });
  form.querySelectorAll('.mcp-remote').forEach((el) => { el.hidden = stdio; });
}

function renderMcp() {
  const page = $('mcp-page');
  const data = mcpUi.data;
  const q = mcpUi.query.toLowerCase();
  const servers = (data?.servers || []).filter((s) => !q || `${s.name} ${s.target} ${s.repo || ''}`.toLowerCase().includes(q));
  const count = (h) => (data?.servers || []).filter((s) => s.health === h).length;
  const groups = MCP_GROUPS.map(([id, label, hint]) => [label, hint, servers.filter((s) => s.source === id)]).filter(([, , list]) => list.length);
  const draft = $('mcp-form') ? Object.fromEntries(new FormData($('mcp-form'))) : null;
  const focus = document.activeElement?.id === 'mcp-search';
  page.innerHTML = `<div class="mcp-head"><h3 class="conn-section">Serveurs MCP</h3><span class="mcp-muted">pour toute l’application</span><span class="mcp-grow"></span>
      <button class="btn" data-mcp-refresh ${data?.checking ? 'disabled' : ''}>${data?.checking ? 'Vérification…' : 'Revérifier'}</button>
      <button class="btn primary" data-mcp-add>${mcpUi.adding ? 'Fermer l’ajout' : 'Ajouter un serveur'}</button></div>
    <div class="mcp-summary">${data ? `<span class="mcp-pill mcp-c-ok">${count('ok')} connectés</span>${count('auth') ? `<span class="mcp-pill mcp-c-auth">${count('auth')} à authentifier</span>` : ''}${count('failed') ? `<span class="mcp-pill mcp-c-failed">${count('failed')} en échec</span>` : ''}${count('pending') ? `<span class="mcp-pill mcp-c-pending">${count('pending')} en attente</span>` : ''}<span class="mcp-muted">${data.checking ? 'Claude vérifie chaque serveur…' : data.checkedAt ? `vérifié ${ago(data.checkedAt)}` : ''}${data.healthError ? ` · ${esc(data.healthError)}` : ''}</span>` : '<span class="mcp-muted">Chargement…</span>'}
      <input id="mcp-search" class="mcp-search" type="search" placeholder="Filtrer" value="${esc(mcpUi.query)}" aria-label="Filtrer les serveurs"></div>
    ${mcpUi.adding ? mcpForm() : ''}
    ${groups.map(([label, hint, list]) => `<section class="mcp-group"><h3>${label}<span class="mcp-n">${list.length}</span><small>${hint}</small></h3>${list.map(mcpRow).join('')}</section>`).join('') || (data ? '<p class="mcp-muted">Aucun serveur.</p>' : '')}`;
  if (draft && $('mcp-form')) for (const [k, v] of Object.entries(draft)) if ($('mcp-form').elements[k]) $('mcp-form').elements[k].value = v;
  syncMcpForm();
  if (focus) { $('mcp-search').focus(); $('mcp-search').setSelectionRange(mcpUi.query.length, mcpUi.query.length); }
}

const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

async function mcpAction(route, body, done) {
  const result = await post(route, body);
  toast(result.ok ? done : result.data.error || 'Action impossible.', result.ok ? '' : 'error');
  if (result.ok) loadMcp(false);
}

$('mcp-dialog').addEventListener('click', (e) => { if (e.target.closest('[data-conn-close]')) $('mcp-dialog').close(); });

$('mcp-page').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-mcp-refresh]')) { loadMcp(true); return; }
  if (t.closest('[data-mcp-add]')) { mcpUi.adding = !mcpUi.adding; renderMcp(); if (mcpUi.adding) $('mcp-form').elements.name.focus(); return; }
  const login = t.closest('[data-mcp-login]');
  if (login) {
    const command = `${login.dataset.provider === 'codex' ? 'codex' : 'claude'} mcp login ${shellQuote(login.dataset.mcpLogin)}`;
    const result = await post('/api/paste', { target: 'shell', text: command });
    if (!result.ok) { toast(result.data.error || 'Terminal indisponible.', 'error'); return; }
    $('mcp-dialog').close();
    select(SHELL);
    toast('Commande de connexion tapée dans le terminal : vérifie-la puis Entrée.');
    return;
  }
  const share = t.closest('[data-mcp-share]');
  if (share) { mcpAction('/api/mcp/share', { name: share.dataset.mcpShare, to: share.dataset.to }, `${share.dataset.mcpShare} ajouté pour ${share.dataset.to === 'codex' ? 'GPT' : 'Claude'}.`); return; }
  const global = t.closest('[data-mcp-global]');
  if (global) {
    if (!confirm(`Rendre ${global.dataset.mcpGlobal} global ? Il sera disponible dans toutes les sessions Claude${global.dataset.scope === 'local' ? ', et retiré de la portée locale du dépôt' : ''}.`)) return;
    mcpAction('/api/mcp/share', { name: global.dataset.mcpGlobal, from: 'repo', repoPath: global.dataset.repo, scope: global.dataset.scope }, `${global.dataset.mcpGlobal} est maintenant global.`);
    return;
  }
  const remove = t.closest('[data-mcp-remove]');
  if (remove) {
    const where = remove.dataset.provider === 'codex' ? 'de GPT' : remove.dataset.scope === 'local' ? 'du dépôt' : 'de Claude';
    if (!confirm(`Retirer ${remove.dataset.mcpRemove} ${where} ?`)) return;
    mcpAction('/api/mcp/remove', { provider: remove.dataset.provider, name: remove.dataset.mcpRemove, scope: remove.dataset.scope, repoPath: remove.dataset.repo }, `${remove.dataset.mcpRemove} retiré.`);
  }
});

$('mcp-page').addEventListener('change', (e) => { if (e.target.closest('#mcp-form')) syncMcpForm(); });
$('mcp-page').addEventListener('input', (e) => { if (e.target.id === 'mcp-search') { mcpUi.query = e.target.value; renderMcp(); } });

$('mcp-page').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('#mcp-form');
  if (!form || mcpUi.busy) return;
  const body = Object.fromEntries(new FormData(form));
  mcpUi.busy = true;
  renderMcp();
  const result = await post('/api/mcp/add', body);
  mcpUi.busy = false;
  if (!result.ok) { renderMcp(); toast(result.data.error || 'Ajout impossible.', 'error'); return; }
  mcpUi.adding = false;
  toast(`${body.name} ajouté pour ${result.data.added.join(' et ')}, dans toute l’application.`);
  loadMcp(true);
});

$('mcp-dialog').addEventListener('close', () => { clearTimeout(mcpUi.timer); clearTimeout(connUi.timer); });
