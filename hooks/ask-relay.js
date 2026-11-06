#!/usr/bin/env node
// PreToolUse hook on AskUserQuestion, for sessions launched by the cockpit (COCKPIT_ASK=1): hands the
// questions to the cockpit and waits for the answer given in its conversation view, then answers Claude
// through updatedInput. "Répondre dans le terminal", a timeout or any error leave the hook without output,
// so Claude Code shows its usual dialog in the terminal. Sessions started elsewhere are never held.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ASK_WAIT_MS, checkAnswers, hookOutput } = require('./ask');

const ASK_DIR = path.join(os.homedir(), '.claude', 'worktree-asks');
const POLL_MS = 400;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (process.env.COCKPIT_ASK !== '1' || input.tool_name !== 'AskUserQuestion' || !input.session_id || !Array.isArray(input.tool_input?.questions)) return;
  const id = String(input.session_id).replace(/[^\w-]/g, '');
  const pendingFile = path.join(ASK_DIR, `${id}.json`);
  const answerFile = path.join(ASK_DIR, `${id}.answer.json`);
  const toolUseId = String(input.tool_use_id || crypto.randomUUID());
  const cleanup = () => {
    if (readJson(pendingFile)?.toolUseId === toolUseId) fs.rmSync(pendingFile, { force: true });
    fs.rmSync(answerFile, { force: true });
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { cleanup(); process.exit(0); });
  try {
    fs.mkdirSync(ASK_DIR, { recursive: true });
    fs.rmSync(answerFile, { force: true });
    writeAtomic(pendingFile, { sessionId: input.session_id, toolUseId, toolInput: input.tool_input, pid: process.pid, at: Date.now() });
  } catch {
    return;
  }
  const deadline = Date.now() + ASK_WAIT_MS;
  const timer = setInterval(() => {
    if (Date.now() > deadline || readJson(pendingFile)?.toolUseId !== toolUseId) {
      clearInterval(timer);
      cleanup();
      return;
    }
    const answer = readJson(answerFile);
    if (!answer || answer.toolUseId !== toolUseId) return;
    clearInterval(timer);
    const checked = answer.defer ? null : checkAnswers(input.tool_input, answer.answers);
    cleanup();
    if (checked?.answers) process.stdout.write(JSON.stringify(hookOutput(input.tool_input, checked.answers)));
  }, POLL_MS);
});
