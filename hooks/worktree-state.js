#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { shorten, applyHookEvent } = require('./state-transition');

const STATE_DIR = path.join(os.homedir(), '.claude', 'worktree-state');
const MAX_CHECKPOINTS = 30;

const CHECKPOINT_SCRIPT = `
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const [cwd, file, at, prompt, max] = process.argv.slice(1);
const git = (args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
try {
  const sha = git(['stash', 'create']) || git(['rev-parse', 'HEAD']);
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  list.push({ at: Number(at), sha, prompt });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-Number(max))));
  fs.renameSync(tmp, file);
} catch {}
`;

function recordCheckpoint(sessionId, cwd, at, prompt) {
  const file = path.join(STATE_DIR, `${sessionId}.checkpoints.json`);
  spawn(process.execPath, ['-e', CHECKPOINT_SCRIPT, cwd, file, String(at), prompt, String(MAX_CHECKPOINTS)], { detached: true, stdio: 'ignore' }).unref();
}

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
    if (!applyHookEvent(state, input, { now, pane: process.env.TMUX_PANE || null, fallbackCwd: process.cwd() })) return;
    if (input.hook_event_name === 'UserPromptSubmit') recordCheckpoint(input.session_id, state.cwd, now, shorten(input.prompt, 120));
    writeState(file, state);
  } catch {}
});
