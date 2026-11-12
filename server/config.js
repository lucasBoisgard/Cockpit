const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { limitPercent } = require('./core/arena-breaker');

const ROOT = path.resolve(__dirname, '..');

function expandEnv(value) {
  if (typeof value === 'string') return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v)]));
  return value;
}

function loadConfig() {
  const file = path.join(ROOT, 'cockpit.config.json');
  if (!fs.existsSync(file)) return {};
  return expandEnv(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function detectRepo() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.dirname(common);
  } catch {
    return process.cwd();
  }
}

const CONFIG = loadConfig();
const REPO = process.env.REPO || CONFIG.repo || detectRepo();
const CLAUDE_BIN = process.env.CLAUDE_BIN || CONFIG.claudeBin || path.join(os.homedir(), '.local', 'bin', 'claude');
const APP = CONFIG.app?.command ? CONFIG.app : null;
const ARENA_LIMIT_PERCENT = limitPercent(CONFIG.arena?.maxUsagePercent);

module.exports = {
  ROOT,
  CONFIG,
  STARTED_AT: Date.now(),
  PORT: Number(process.env.PORT || 4747),
  HOST: process.env.HOST || '127.0.0.1',
  REPO,
  CLAUDE_BIN,
  STATE_DIR: path.join(os.homedir(), '.claude', 'worktree-state'),
  PROJECTS_DIR: path.join(os.homedir(), '.claude', 'projects'),
  CLAUDE_SESSIONS_DIR: path.join(os.homedir(), '.claude', 'sessions'),
  REVIEWS_DIR: path.join(os.homedir(), '.claude', 'worktree-reviews'),
  USAGE_DIR: path.join(os.homedir(), '.claude', 'worktree-usage'),
  DATA_DIR: path.join(os.homedir(), '.claude'),
  BASE_BRANCH: CONFIG.pr?.base || CONFIG.baseBranch || 'master',
  TICK_MS: 3000,
  TICK_ENABLED: process.env.COCKPIT_TICK === '1',
  SHELL_SESSION: 'cw-shell',
  APP_SESSION: 'cw-app',
  APP,
  ARENA_LIMIT_PERCENT,
  MATRIX_MAINTAINER: CONFIG.matrix?.maintainer === true,
  USE_PM2: APP?.processManager === 'pm2',
  PM2_BIN: APP?.pm2Bin || (fs.existsSync(path.join(REPO, 'node_modules', '.bin', 'pm2')) ? path.join(REPO, 'node_modules', '.bin', 'pm2') : 'pm2'),
  PM2_PID_FILE: path.join(os.homedir(), '.pm2', 'pm2.pid'),
  MIGRATIONS: APP?.migrations?.command && APP.migrations.paths?.length ? APP.migrations : null,
  TOKEN_FILE: path.join(ROOT, 'token'),
  ALLOWED_HOSTS: new Set(['localhost', '127.0.0.1', '[::1]', process.env.MACHINE_HOSTNAME, ...(CONFIG.hosts || []), ...(process.env.COCKPIT_HOSTS || '').split(',')].map((h) => (h || '').trim().toLowerCase()).filter(Boolean)),
  TMUX_SIZE: ['-x', '200', '-y', '50'],
  TMUX_PATH: `PATH=${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}:${path.dirname(CLAUDE_BIN)}`,
};
