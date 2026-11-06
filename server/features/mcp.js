const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { REPO, CLAUDE_BIN } = require('../config');
const core = require('../core/mcp');
const { CODEX_BIN, codexInfo } = require('./providers');
const { listWorktrees } = require('./worktrees');

// MCP servers are managed once for the whole cockpit: what is added here goes to Claude's user scope and to
// Codex's global config, so every session of every worktree gets it. Servers a repository declares (its
// .mcp.json, or Claude's local scope for it) are listed apart and can be made global.
const HEALTH_TTL_MS = 5 * 60 * 1000;
let health = { at: 0, running: false, list: null, error: null };

function exec(bin, args, timeout = 30000, cwd = REPO) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, stdout: stdout || '', stderr: (stderr || (error ? error.message : '')).trim() }));
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const claudeUserConfig = () => readJson(path.join(os.homedir(), '.claude.json')) || {};

async function knownRepos() {
  const repos = new Set([REPO]);
  for (const wt of await listWorktrees()) if (wt.repo) repos.add(wt.repo);
  return [...repos].filter((r) => fs.existsSync(r));
}

// `claude mcp list` connects to every server to report its health: run once in the background, cached.
function checkHealth() {
  if (health.running) return;
  health = { ...health, running: true };
  exec(CLAUDE_BIN, ['mcp', 'list'], 120000).then((result) => {
    health = { at: Date.now(), running: false, list: result.ok ? core.parseClaudeList(result.stdout) : health.list, error: result.ok ? null : result.stderr.slice(0, 300) };
  });
}

async function codexServersRaw() {
  const codex = await codexInfo();
  if (!codex.installed) return { installed: false, list: [] };
  const result = await exec(CODEX_BIN, ['mcp', 'list', '--json']);
  return { installed: true, list: result.ok ? core.codexServers(result.stdout) : [] };
}

async function listMcp({ refresh } = {}) {
  if (refresh || (!health.running && Date.now() - health.at > HEALTH_TTL_MS)) checkHealth();
  const user = claudeUserConfig();
  const codex = await codexServersRaw();
  const global = core.claudeServers({ user: user.mcpServers || {}, list: health.list }).filter((s) => s.source !== 'local' && s.source !== 'project');
  const repos = [];
  for (const repo of await knownRepos()) {
    const project = readJson(path.join(repo, '.mcp.json'))?.mcpServers || {};
    const local = user.projects?.[repo]?.mcpServers || {};
    repos.push(...core.repoServers(path.basename(repo), { project, local }, health.list).map((s) => ({ ...s, repoPath: repo })));
  }
  const servers = core.markShared([...global, ...codex.list, ...repos]);
  return { checking: health.running, checkedAt: health.at || null, healthError: health.error, codexInstalled: codex.installed, servers };
}

async function addMcp(body = {}) {
  const checked = core.validateAdd({ ...body, scope: 'user' });
  if (checked.error) return checked;
  const done = [];
  for (const provider of checked.providers) {
    const result = provider === 'codex' ? await exec(CODEX_BIN, core.codexAddArgs(checked)) : await exec(CLAUDE_BIN, core.claudeAddArgs(checked));
    if (!result.ok) return { error: `${provider === 'codex' ? 'GPT' : 'Claude'} : ${result.stderr || 'ajout refusé'}${done.length ? ` (ajouté pour ${done.join(', ')})` : ''}` };
    done.push(provider === 'codex' ? 'GPT' : 'Claude');
  }
  health.at = 0;
  return { ok: true, added: done };
}

async function removeMcp({ provider, name, scope, repoPath }) {
  const args = core.removeArgs(provider, name, provider === 'codex' ? null : scope || 'user');
  if (!args) return { error: 'Ce serveur ne se retire pas d’ici (connecteur claude.ai ou plugin).' };
  const cwd = scope === 'local' && repoPath && (await knownRepos()).includes(repoPath) ? repoPath : REPO;
  const result = await exec(provider === 'codex' ? CODEX_BIN : CLAUDE_BIN, args, 30000, cwd);
  if (!result.ok) return { error: result.stderr || 'Retrait refusé.' };
  health.at = 0;
  return { ok: true };
}

// Copies a server to the other provider (or a repository server to Claude's user scope) server-side: env
// values and headers never go through the page.
async function shareMcp({ name, to, from, repoPath, scope }) {
  const user = claudeUserConfig();
  if (from === 'repo') {
    if (!(await knownRepos()).includes(repoPath)) return { error: 'Dépôt inconnu.' };
    const cfg = scope === 'local' ? user.projects?.[repoPath]?.mcpServers?.[name] : readJson(path.join(repoPath, '.mcp.json'))?.mcpServers?.[name];
    if (!cfg) return { error: 'Serveur introuvable dans ce dépôt.' };
    const added = await exec(CLAUDE_BIN, ['mcp', 'add-json', name, JSON.stringify(core.claudeJson(cfg)), '-s', 'user']);
    if (!added.ok) return { error: added.stderr || 'Ajout refusé.' };
    if (scope === 'local') await exec(CLAUDE_BIN, ['mcp', 'remove', name, '-s', 'local'], 30000, repoPath);
    health.at = 0;
    return { ok: true };
  }
  if (to === 'codex') {
    const cfg = user.mcpServers?.[name];
    if (!cfg) return { error: 'Seuls les serveurs globaux de Claude se copient vers GPT (pas les connecteurs claude.ai ni les plugins).' };
    const built = core.codexArgsFromConfig(name, cfg);
    if (built.error) return built;
    const added = await exec(CODEX_BIN, built.args);
    return added.ok ? { ok: true } : { error: added.stderr || 'Ajout refusé.' };
  }
  if (to === 'claude') {
    const got = await exec(CODEX_BIN, ['mcp', 'get', name, '--json']);
    let server;
    try { server = JSON.parse(got.stdout); } catch { server = null; }
    if (!got.ok || !server) return { error: 'Serveur GPT introuvable.' };
    const transport = server.transport || server;
    const added = await exec(CLAUDE_BIN, ['mcp', 'add-json', name, JSON.stringify(core.claudeJson(transport)), '-s', 'user']);
    health.at = 0;
    return added.ok ? { ok: true } : { error: added.stderr || 'Ajout refusé.' };
  }
  return { error: 'Destination inconnue.' };
}

module.exports = { listMcp, addMcp, removeMcp, shareMcp };
