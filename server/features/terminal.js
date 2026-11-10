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
  const loaded = await tmux(['load-buffer', '-b', buffer, '-'], text);
  if (!loaded.ok) return { error: loaded.stderr || 'Texte non chargé dans le terminal.' };
  const pasted = await tmux(['paste-buffer', '-p', '-d', '-b', buffer, '-t', target]);
  if (!pasted.ok) return { error: pasted.stderr || 'Texte non collé dans le terminal.' };
  return { ok: true };
}

async function submitText(target, text) {
  const pasted = await pasteText(target, text);
  if (pasted.error) return pasted;
  await sleep(150);
  const sent = await tmux(['send-keys', '-t', target, 'Enter']);
  return sent.ok ? { ok: true } : { error: sent.stderr || 'Entrée non envoyée au terminal.' };
}

async function sendOps(target, ops) {
  for (const op of ops) {
    let result;
    if (typeof op.literal === 'string' && op.literal) result = await tmux(['send-keys', '-t', target, '-l', op.literal]);
    else if (NAMED_KEYS.has(op.key)) result = await tmux(['send-keys', '-t', target, op.key]);
    else return { error: 'Touche invalide.' };
    if (!result.ok) return { error: result.stderr || 'Envoi au terminal impossible.' };
  }
  return { ok: true };
}

async function screen(target) {
  const result = await tmux(['capture-pane', '-p', '-e', '-t', target, '-S', `-${SCREEN_HISTORY_LINES}`]);
  return result.ok ? result.stdout.replace(/\s+$/, '') : null;
}

const screenHash = (text) => crypto.createHash('md5').update(text).digest('hex');

module.exports = { resolveTarget, pasteText, submitText, sendOps, screen, screenHash };
