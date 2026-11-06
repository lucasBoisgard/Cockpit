const os = require('node:os');
const path = require('node:path');
const { ROOT, CONFIG } = require('../config');
const { run } = require('../io/exec');
const core = require('../core/providers');

const CODEX_BIN = process.env.CODEX_BIN || CONFIG.providers?.codex?.bin || 'codex';
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, 'sessions');
const INFO_TTL_MS = 60000;
let codexCache = null;

const binOf = (providerId) => (providerId === 'codex' ? CODEX_BIN : null);
const codexHookCommand = () => `node ${ROOT}/hooks/worktree-state.js codex`;

// Whether Codex is installed and logged in, and the models its catalog lists.
async function codexInfo() {
  if (codexCache && Date.now() - codexCache.at < INFO_TTL_MS) return codexCache.info;
  const [status, models] = await Promise.all([run(CODEX_BIN, ['login', 'status']), run(CODEX_BIN, ['debug', 'models'])]);
  let list = [];
  try {
    list = JSON.parse(models.stdout).models.filter((m) => m.visibility !== 'hide').map((m) => ({ id: m.slug, label: m.display_name || m.slug, efforts: (m.supported_reasoning_levels || []).map((r) => r.effort) }));
  } catch {}
  const installed = status.ok || models.ok || /logged|login/i.test(`${status.stdout}${status.stderr}`);
  const info = { installed, loggedIn: status.ok && !/not logged in/i.test(`${status.stdout}${status.stderr}`), models: list.length ? list : core.CODEX_DEFAULT_MODELS.map((id) => ({ id, label: id, efforts: core.PROVIDERS.codex.efforts })) };
  codexCache = { at: Date.now(), info };
  return info;
}

// The catalog with each model's efforts, so a launch is checked against what that model takes.
async function codexCatalog() {
  return (await codexInfo()).models;
}

async function providersInfo() {
  const codex = await codexInfo();
  return {
    claude: { label: core.PROVIDERS.claude.label, keys: core.PROVIDERS.claude.keys, available: true, models: core.CLAUDE_MODELS.map((id) => ({ id, label: id })), efforts: core.PROVIDERS.claude.efforts, modes: core.PROVIDERS.claude.modes },
    codex: { label: core.PROVIDERS.codex.label, keys: core.PROVIDERS.codex.keys, available: codex.installed && codex.loggedIn, installed: codex.installed, loggedIn: codex.loggedIn, models: codex.models, efforts: core.PROVIDERS.codex.efforts, modes: core.PROVIDERS.codex.modes },
  };
}

const forgetCodexInfo = () => { codexCache = null; };

module.exports = { forgetCodexInfo, CODEX_BIN, CODEX_SESSIONS_DIR, binOf, codexHookCommand, codexInfo, codexCatalog, providersInfo };
