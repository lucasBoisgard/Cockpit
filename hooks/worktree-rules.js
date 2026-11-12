// Rules for Claude Code sessions running in a worktree (`<repo>/.claude/worktrees/<name>`), read from the
// `worktrees` section of cockpit.config.json: the context injected at session start and the commands refused.
// Kept light (no server modules): it runs on every session start and before every Bash command.
const fs = require('node:fs');
const path = require('node:path');

const MARKER = '/.claude/worktrees/';

const INCLUDE_MARKER = '# Written by the cockpit from worktrees.include in cockpit.config.json: edit it there.';

function expandEnv(value) {
  if (typeof value === 'string') return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v)]));
  return value;
}

function loadConfig(file = path.join(__dirname, '..', 'cockpit.config.json')) {
  try {
    return expandEnv(JSON.parse(fs.readFileSync(file, 'utf8'))) || {};
  } catch {
    return {};
  }
}

function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

// The worktree a directory belongs to, for the configured repo (or any repo when none is configured).
function worktreeOf(cwd, repo) {
  const dir = String(cwd || '');
  const at = dir.indexOf(MARKER);
  if (at < 0) return null;
  const root = dir.slice(0, at);
  if (repo && realPath(root) !== realPath(repo)) return null;
  const name = dir.slice(at + MARKER.length).split('/')[0];
  return name ? { root, name, path: `${root}${MARKER}${name}` } : null;
}

function settingsOf(config = {}) {
  const w = config.worktrees || {};
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    include: list(w.include).map(String).filter(Boolean),
    setup: list(w.setup).filter((s) => s && s.missing && s.hint),
    rules: list(w.rules).map(String).filter(Boolean),
    forbidden: list(w.forbidden).filter((f) => f && f.pattern && f.label),
  };
}

function contextLines({ worktree, branch, settings, exists }) {
  const lines = [`Session in worktree "${worktree.name}" (branch ${branch || '?'}), next to other sessions working in parallel.`, 'Load and follow the `worktree-session` skill before any action.'];
  for (const rule of settings.rules) lines.push(`- ${rule}`);
  if (settings.forbidden.length) lines.push(`Refused in a worktree: ${settings.forbidden.map((f) => f.label).join(', ')}.`);
  for (const s of settings.setup) if (!exists(path.join(worktree.path, s.missing))) lines.push(`${s.missing} is missing: ${s.hint}`);
  return lines;
}

// The label of the first forbidden pattern the command matches, or null. An invalid pattern is skipped.
function forbiddenLabel(command, settings) {
  for (const f of settings.forbidden) {
    try {
      if (new RegExp(f.pattern, 'i').test(String(command || ''))) return f.label;
    } catch {
      continue;
    }
  }
  return null;
}

const includeText = (settings) => (settings.include.length ? `${INCLUDE_MARKER}\n${settings.include.join('\n')}\n` : '');

// The cockpit only writes a `.worktreeinclude` that is missing or that it wrote itself: a hand-written one is kept.
const ownsInclude = (current) => current === null || current === '' || current.split('\n')[0] === INCLUDE_MARKER;

module.exports = { loadConfig, worktreeOf, settingsOf, contextLines, forbiddenLabel, includeText, ownsInclude, INCLUDE_MARKER };
