const crypto = require('node:crypto');
const { REPO, SHELL_SESSION, APP_SESSION, TMUX_SIZE, TMUX_PATH } = require('../config');
const { tmux, sleep } = require('../io/exec');
const { readSession, loadStore } = require('../io/store');
const { paneOf } = require('../core/sessions');
const { livePanes } = require('./worktrees');

const SCREEN_HISTORY_LINES = 500;
const NAMED_KEYS = new Set(['Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'BTab', 'BSpace', 'DC', 'Home', 'End', 'PPage', 'NPage', 'C-a', 'C-c', 'C-d', 'C-e', 'C-k', 'C-l', 'C-o', 'C-r', 'C-u', 'C-w', 'C-z']);

async function ensureShell() {
  if ((await tmux(['has-session', '-t', SHELL_SESSION])).ok) return;
  await tmux(['new-session', '-d', '-s', SHELL_SESSION, ...TMUX_SIZE, '-c', REPO, '-e', TMUX_PATH, 'bash', '-l']);
}

async function resolveTarget(target) {
  if (target === 'shell') {
    await ensureShell();
    return `${SHELL_SESSION}:`;
  }
  if (target === 'app') return (await tmux(['has-session', '-t', APP_SESSION])).ok ? `${APP_SESSION}:` : null;
  // A Codex session launched by the cockpit and not attached yet (see codex-screens.js).
  if (String(target || '').startsWith('codex-screen:')) {
    const name = String(target).slice('codex-screen:'.length);
    const known = loadStore('worktree-codex-launches.json', []).some((l) => l.tmux === name);
    return known && (await tmux(['has-session', '-t', name])).ok ? `${name}:` : null;
  }
  return paneOf(readSession(String(target || '')), await livePanes());
}

async function pasteText(target, text) {
  const buffer = `cw-${process.pid}-${Date.now()}`;
  await tmux(['load-buffer', '-b', buffer, '-'], text);
  await tmux(['paste-buffer', '-p', '-d', '-b', buffer, '-t', target]);
}

async function submitText(target, text) {
  await pasteText(target, text);
  await sleep(150);
  await tmux(['send-keys', '-t', target, 'Enter']);
}

async function sendOps(target, ops) {
  for (const op of ops) {
    if (typeof op.literal === 'string' && op.literal) await tmux(['send-keys', '-t', target, '-l', op.literal]);
    else if (NAMED_KEYS.has(op.key)) await tmux(['send-keys', '-t', target, op.key]);
  }
}

async function screen(target) {
  const result = await tmux(['capture-pane', '-p', '-e', '-t', target, '-S', `-${SCREEN_HISTORY_LINES}`]);
  return result.ok ? result.stdout.replace(/\s+$/, '') : null;
}

const screenHash = (text) => crypto.createHash('md5').update(text).digest('hex');

module.exports = { resolveTarget, pasteText, submitText, sendOps, screen, screenHash };
