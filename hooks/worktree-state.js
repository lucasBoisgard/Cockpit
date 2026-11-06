#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyHookEvent } = require('./state-transition');

const STATE_DIR = path.join(os.homedir(), '.claude', 'worktree-state');
function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { actions: [] };
  }
}

function writeState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

// How the cockpit launched this session (provider settings), so a resume keeps them.
function launchOf(value) {
  try {
    const { model, effort, mode } = JSON.parse(value || 'null') || {};
    return model || effort || mode ? { model: model || null, effort: effort || null, mode: mode || null } : null;
  } catch {
    return null;
  }
}

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  if (process.env.COCKPIT_HIDDEN === '1') return;
  try {
    const input = JSON.parse(raw);
    if (!input.session_id) return;
    fs.mkdirSync(STATE_DIR, { recursive: true });

    const file = path.join(STATE_DIR, `${input.session_id}.json`);
    const state = readState(file);
    const now = Date.now();
    if (!applyHookEvent(state, input, { now, pane: process.env.TMUX_PANE || null, fallbackCwd: process.cwd(), provider: process.argv[2] || 'claude', launch: launchOf(process.env.COCKPIT_LAUNCH) })) return;
    writeState(file, state);
  } catch {}
});
