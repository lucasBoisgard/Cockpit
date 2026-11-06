// Answering Claude's AskUserQuestion from the cockpit conversation, without I/O (shared by the relay hook,
// the state hook and the server). A PreToolUse hook answers by allowing the tool with updatedInput: the
// original questions plus `answers`, keyed by question text (multi-select labels joined with ", ").

const ASK_WAIT_MS = 25 * 60 * 1000;
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 8;
const MAX_TEXT = 2000;

const clip = (text, max) => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

// What the cockpit shows: the questions with their options and descriptions, bounded.
function questionsOf(toolInput = {}) {
  const list = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  return list.slice(0, MAX_QUESTIONS).map((q) => ({
    question: clip(q.question, 500),
    header: clip(q.header, 40),
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).slice(0, MAX_OPTIONS).map((o) => ({ label: clip(o.label, 120), description: clip(o.description, 300) })),
  })).filter((q) => q.question);
}

// answers: { [question text]: label | free text | [labels…] } → the answers Claude Code expects.
function checkAnswers(toolInput, answers) {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : [];
  if (!questions.length) return { error: 'Plus de question en attente.' };
  const out = {};
  for (const q of questions) {
    const given = answers?.[q.question];
    const values = (Array.isArray(given) ? given : [given]).map((v) => String(v ?? '').trim()).filter(Boolean);
    if (!values.length) return { error: `Réponds à : ${clip(q.question, 80)}` };
    if (!q.multiSelect && values.length > 1) return { error: `Un seul choix pour : ${clip(q.question, 80)}` };
    if (values.some((v) => v.length > MAX_TEXT)) return { error: 'Réponse trop longue (2 000 caractères au plus).' };
    out[q.question] = values.join(', ');
  }
  return { answers: out };
}

function hookOutput(toolInput, answers) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Réponse donnée dans le cockpit',
      updatedInput: { ...toolInput, questions: toolInput.questions, answers },
    },
  };
}

module.exports = { ASK_WAIT_MS, questionsOf, checkAnswers, hookOutput };
