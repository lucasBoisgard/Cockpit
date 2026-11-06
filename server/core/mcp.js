// MCP servers of Claude Code and Codex, without I/O: parse what the CLIs and config files say, merge it
// into one list per origin, and build the add/remove commands. Secrets (env values, headers) never leave.

const CLAUDE_SCOPES = ['local', 'project', 'user'];
const TRANSPORTS = ['stdio', 'http', 'sse'];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;

function healthOf(text) {
  const t = String(text || '');
  if (/connected/i.test(t)) return 'ok';
  if (/auth/i.test(t)) return 'auth';
  if (/pending/i.test(t)) return 'pending';
  if (/disabled/i.test(t)) return 'disabled';
  if (/fail|error|✗/i.test(t)) return 'failed';
  return 'unknown';
}

// `claude mcp list`: "name: command or url - ✔ Connected", one server per line.
function parseClaudeList(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^(.+?): (.+) - (.+)$/);
    if (m) out.push({ name: m[1].trim(), target: m[2].trim(), health: healthOf(m[3]), healthText: m[3].replace(/^[^\p{L}]+/u, '').trim() });
  }
  return out;
}

function describe(cfg = {}) {
  const transport = cfg.type === 'streamable_http' ? 'http' : cfg.type || (cfg.url ? 'http' : 'stdio');
  const target = cfg.url || [cfg.command, ...(cfg.args || [])].filter(Boolean).join(' ');
  return { transport, target, envKeys: Object.keys(cfg.env || {}), headerKeys: Object.keys(cfg.headers || {}) };
}

// One list for Claude Code: what its config files declare (with their scope) plus what only the CLI knows
// (claude.ai connectors, plugins), each with its health when the last check has it.
function claudeServers({ user = {}, local = {}, project = {}, list = null }) {
  const health = new Map((list || []).map((s) => [s.name, s]));
  const out = [];
  const add = (source, scope, servers) => {
    for (const [name, cfg] of Object.entries(servers || {})) out.push({ provider: 'claude', source, scope, name, ...describe(cfg), health: health.get(name)?.health || (list ? 'unknown' : 'checking'), healthText: health.get(name)?.healthText || '', removable: true });
  };
  add('local', 'local', local);
  add('project', 'project', project);
  add('user', 'user', user);
  for (const s of list || []) {
    if (out.some((o) => o.name === s.name)) continue;
    const connector = s.name.startsWith('claude.ai ');
    out.push({ provider: 'claude', source: connector ? 'claude.ai' : 'plugin', scope: null, name: s.name, transport: /^https?:/.test(s.target) ? 'http' : 'stdio', target: s.target, envKeys: [], headerKeys: [], health: s.health, healthText: s.healthText, removable: false });
  }
  return out;
}

// `codex mcp list --json`: an array of servers with their transport.
function codexServers(json) {
  let list = [];
  try { list = typeof json === 'string' ? JSON.parse(json || '[]') : json || []; } catch { list = []; }
  return (Array.isArray(list) ? list : []).map((s) => {
    const transport = s.transport || s;
    return { provider: 'codex', source: 'codex', scope: 'global', name: String(s.name), ...describe(transport), health: s.enabled === false ? 'disabled' : s.auth_status && /not.?logged|unauth/i.test(String(s.auth_status)) ? 'auth' : 'unknown', healthText: s.enabled === false ? 'Désactivé' : '', removable: true };
  });
}

// Splits a command line on spaces, keeping quoted parts together.
function splitCommand(text) {
  return [...String(text || '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function validateAdd(input = {}) {
  const providers = input.provider === 'both' ? ['claude', 'codex'] : [input.provider || 'claude'];
  if (providers.some((p) => !['claude', 'codex'].includes(p))) return { error: 'Fournisseur inconnu.' };
  const name = String(input.name || '').trim();
  if (!NAME_RE.test(name)) return { error: 'Nom invalide : lettres, chiffres, . _ @ - (64 au plus).' };
  const transport = input.transport || 'stdio';
  if (!TRANSPORTS.includes(transport)) return { error: 'Transport inconnu.' };
  if (transport === 'sse' && providers.includes('codex')) return { error: 'Codex ne prend pas le transport SSE : choisis HTTP ou stdio.' };
  const scope = input.scope || 'local';
  if (!CLAUDE_SCOPES.includes(scope)) return { error: 'Portée inconnue.' };
  const env = String(input.env || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (env.some((l) => !ENV_RE.test(l))) return { error: 'Variables : une par ligne, au format NOM=valeur.' };
  const headers = String(input.headers || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (headers.some((h) => !/^[\w-]+:\s?.+$/.test(h))) return { error: 'En-têtes : un par ligne, au format Nom: valeur.' };
  if (headers.length && (transport === 'stdio' || providers.includes('codex'))) return { error: 'Les en-têtes ne valent que pour un serveur HTTP ou SSE de Claude.' };
  if (transport === 'stdio') {
    const command = splitCommand(input.command);
    if (!command.length) return { error: 'Donne la commande qui lance le serveur.' };
    return { providers, name, transport, scope, command, env, headers };
  }
  const url = String(input.url || '').trim();
  if (!/^https?:\/\/\S+$/.test(url)) return { error: 'Donne l’URL http(s) du serveur.' };
  if (env.length) return { error: 'Les variables d’environnement ne valent que pour un serveur stdio.' };
  return { providers, name, transport, scope, url, env, headers };
}

// The name comes first: -e and -H take several values and would swallow it.
function claudeAddArgs(n) {
  const opts = ['-s', n.scope, '-t', n.transport, ...n.env.flatMap((e) => ['-e', e]), ...n.headers.flatMap((h) => ['-H', h])];
  return n.transport === 'stdio' ? ['mcp', 'add', n.name, ...opts, '--', ...n.command] : ['mcp', 'add', n.name, n.url, ...opts];
}

function codexAddArgs(n) {
  return n.transport === 'stdio' ? ['mcp', 'add', n.name, ...n.env.flatMap((e) => ['--env', e]), '--', ...n.command] : ['mcp', 'add', n.name, '--url', n.url];
}

function removeArgs(provider, name, scope) {
  if (!NAME_RE.test(String(name || ''))) return null;
  if (provider === 'codex') return ['mcp', 'remove', name];
  return CLAUDE_SCOPES.includes(scope) ? ['mcp', 'remove', name, '-s', scope] : null;
}

// Servers declared by a repository (its .mcp.json, or Claude's local scope for it): shown apart, they only
// apply in that repository; "Rendre global" copies them to the user scope.
function repoServers(repoName, { project = {}, local = {} }, list = null) {
  const health = new Map((list || []).map((s) => [s.name, s]));
  const rows = [];
  for (const [scope, servers] of [['project', project], ['local', local]]) {
    for (const [name, cfg] of Object.entries(servers || {})) rows.push({ provider: 'claude', source: 'repo', scope, repo: repoName, name, ...describe(cfg), health: health.get(name)?.health || 'unknown', healthText: health.get(name)?.healthText || '', removable: scope === 'local' });
  }
  return rows;
}

// Marks which global servers exist for both providers, by name.
function markShared(servers) {
  const claude = new Set(servers.filter((s) => s.provider === 'claude' && ['user', 'plugin', 'claude.ai'].includes(s.source)).map((s) => s.name));
  const codex = new Set(servers.filter((s) => s.provider === 'codex').map((s) => s.name));
  return servers.map((s) => ({ ...s, inClaude: claude.has(s.name), inCodex: codex.has(s.name) }));
}

// A Claude server config as `claude mcp add-json` takes it.
function claudeJson(cfg = {}) {
  const transport = cfg.type === 'streamable_http' ? 'http' : cfg.type || (cfg.url ? 'http' : 'stdio');
  if (transport === 'stdio') return { type: 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env || {} };
  return { type: transport, url: cfg.url, ...(cfg.headers && Object.keys(cfg.headers).length ? { headers: cfg.headers } : {}) };
}

// `codex mcp add` arguments for a Claude config, or why Codex cannot take it.
function codexArgsFromConfig(name, cfg = {}) {
  if (!NAME_RE.test(name)) return { error: 'Nom incompatible avec Codex.' };
  const json = claudeJson(cfg);
  if (json.type === 'sse') return { error: 'Codex ne prend pas les serveurs SSE.' };
  if (json.headers) return { error: 'Codex ne prend pas d’en-têtes HTTP : ajoute ce serveur côté GPT avec une variable d’environnement de jeton.' };
  if (json.type === 'stdio') {
    if (!json.command) return { error: 'Commande introuvable dans la config.' };
    return { args: ['mcp', 'add', name, ...Object.entries(json.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--', json.command, ...json.args] };
  }
  return { args: ['mcp', 'add', name, '--url', json.url] };
}

module.exports = { repoServers, markShared, claudeJson, codexArgsFromConfig, CLAUDE_SCOPES, TRANSPORTS, healthOf, parseClaudeList, describe, claudeServers, codexServers, splitCommand, validateAdd, claudeAddArgs, codexAddArgs, removeArgs };
