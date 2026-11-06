// Where a message typed in the composer goes, without I/O. Like the CLI, a message always reaches the
// session: while Claude works it is taken into account during the turn. Only a clearly independent task,
// sent while the session is busy, starts a parallel session in the same worktree instead.

const SHORT_WORDS = 8;
const FOLLOW_UP = /^(stop|arr[êe]te|attends?|non\b|oui\b|ok\b|d'accord|aussi|et\b|plut[ôo]t|en fait|mais|pas\b|n'oublie|ajoute aussi|au fait|merci|parfait|continue|vas-y|go\b)/i;

const clip = (text, max) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

// What to do before asking a model: 'queue' (Claude waits on a question or a permission: typing would
// answer it), 'session' (the session is free, or the message is obviously about the current work) or
// null (the session is busy and the message may be a new task: ask).
function quickRoute(status, message) {
  if (status === 'needs_input') return 'queue';
  if (status !== 'working') return 'session';
  const text = String(message || '').trim();
  if (text.startsWith('/') || FOLLOW_UP.test(text) || text.split(/\s+/).length <= SHORT_WORDS) return 'session';
  return null;
}

function routePrompt({ task, lastAssistant, actions, message }) {
  const recent = (actions || []).slice(0, 5).map((a) => `- ${a.tool}: ${clip(a.detail, 120)}`).join('\n') || '- (aucune)';
  return [
    'A Claude Code session is working on a task. The user just typed a new message while it works.',
    'Decide whether the message belongs to that session (a follow-up, a correction, a precision, a question about the work, anything that needs its context) or is an independent new task that another session could do in parallel without the current context.',
    'When in doubt, choose "session".',
    '',
    `Current task: ${clip(task, 600) || '(unknown)'}`,
    `Last message from Claude: ${clip(lastAssistant, 400) || '(none)'}`,
    `Recent actions:\n${recent}`,
    '',
    `New message: ${clip(message, 1500)}`,
    '',
    'Answer with one line of JSON only: {"route":"session"|"parallel","reason":"<short reason in French, 12 words max>"}',
  ].join('\n');
}

// The model's answer → { route, reason }; anything unclear stays in the session.
function parseRoute(text) {
  const match = String(text || '').match(/\{[\s\S]*?\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : '');
    return { route: parsed.route === 'parallel' ? 'parallel' : 'session', reason: clip(parsed.reason, 140) || null };
  } catch {
    return { route: 'session', reason: null };
  }
}

module.exports = { quickRoute, routePrompt, parseRoute };
