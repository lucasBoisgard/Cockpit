const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../config');
const { questionsOf, checkAnswers } = require('../../hooks/ask');

// Questions held by the ask-relay hook (hooks/ask-relay.js) until the user answers in the conversation.
const ASK_DIR = path.join(DATA_DIR, 'worktree-asks');
const fileOf = (sessionId, suffix = '') => path.join(ASK_DIR, `${String(sessionId).replace(/[^\w-]/g, '')}${suffix}.json`);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPending(sessionId) {
  try {
    const pending = JSON.parse(fs.readFileSync(fileOf(sessionId), 'utf8'));
    return pending && alive(pending.pid) ? pending : null;
  } catch {
    return null;
  }
}

// What the conversation shows: the questions of a relay that is still waiting.
function pendingAsk(sessionId) {
  const pending = readPending(sessionId);
  return pending ? { toolUseId: pending.toolUseId, at: pending.at, questions: questionsOf(pending.toolInput) } : null;
}

function answerAsk({ session, toolUseId, answers, defer }) {
  const pending = readPending(String(session || ''));
  if (!pending || pending.toolUseId !== String(toolUseId || '')) return { error: 'Cette question n’attend plus de réponse : elle a peut-être été traitée dans le terminal.' };
  const checked = defer ? { answers: null } : checkAnswers(pending.toolInput, answers);
  if (checked.error) return checked;
  const file = fileOf(session, '.answer');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(defer ? { toolUseId: pending.toolUseId, defer: true } : { toolUseId: pending.toolUseId, answers: checked.answers }));
  fs.renameSync(tmp, file);
  return { ok: true };
}

module.exports = { ASK_DIR, pendingAsk, answerAsk };
