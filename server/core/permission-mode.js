// Pure decisions of the permission-mode propagation: reading the mode of a Claude Code session from its
// screen, how many Shift+Tab presses reach another mode, and what to do for each kind of session.

const MODE_CYCLE = ['acceptEdits', 'plan', 'auto', 'default'];
// From the strictest to the most permissive: an agent may be launched stricter than its orchestration, never looser.
const MODE_RANK = ['plan', 'default', 'acceptEdits', 'auto'];
const MODE_LABELS = { acceptEdits: 'accepter les modifs', auto: 'auto', default: 'par défaut', plan: 'plan' };

const FOOTERS = [
  [/auto mode on/, 'auto'],
  [/accept edits on/, 'acceptEdits'],
  [/plan mode on/, 'plan'],
  [/bypass permissions on/, 'bypass'],
  [/manual mode on|\? for shortcuts/, 'default'],
];

// The mode shown in the footer of the prompt; null when no footer shows (a dialog is open, the screen
// is loading), so that nothing is ever pressed blindly.
function modeFromScreen(text) {
  const lines = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').slice(-8).reverse();
  for (const line of lines) {
    const lower = line.toLowerCase();
    const found = FOOTERS.find(([pattern]) => pattern.test(lower));
    if (found) return found[1];
  }
  return null;
}

// Shift+Tab presses from one mode to another, or null when either is outside the cycle.
function cyclePresses(current, target) {
  const from = MODE_CYCLE.indexOf(current);
  const to = MODE_CYCLE.indexOf(target);
  if (from < 0 || to < 0) return null;
  return (to - from + MODE_CYCLE.length) % MODE_CYCLE.length;
}

const isStricter = (a, b) => MODE_RANK.indexOf(a) < MODE_RANK.indexOf(b);

// An explicit mode at launch is accepted only when it is not more permissive than the orchestration's.
function overrideError(requested, inherited) {
  if (!requested || MODE_RANK.indexOf(requested) < 0 || MODE_RANK.indexOf(inherited) < 0) return null;
  return isStricter(inherited, requested) ? `Mode ${requested} refusé : l'orchestration est en ${MODE_LABELS[inherited]}, un agent ne peut qu'être plus strict (${MODE_RANK.slice(0, MODE_RANK.indexOf(inherited)).join(', ') || 'aucun mode plus strict'}).` : null;
}

// What a new mode means for one agent, from its provider and status:
//  - record: nothing runs, the stored mode is what the next resume uses;
//  - cycle: a Claude prompt takes Shift+Tab, also during a turn (the next tool call uses the new mode);
//  - relaunch: restart with --resume and the new mode, keeping the conversation;
//  - keep: it was launched stricter than the new mode and stays so;
//  - defer: no safe move now, applied when its turn ends.
function agentModeAction({ provider, status, permission, kept }) {
  if (kept) return 'keep';
  if (status === 'stopped') return 'record';
  if (provider === 'codex') return status === 'needs' || status === 'done' ? 'relaunch' : 'defer';
  if (status === 'working' || status === 'done') return 'cycle';
  if (status === 'needs' && permission) return 'relaunch';
  return 'defer';
}

// The master is never restarted: it runs the orchestration. Its prompt takes Shift+Tab; behind a dialog
// it waits for its turn to end.
function masterModeAction(masterStatus) {
  if (masterStatus === 'ended') return 'record';
  return ['working', 'idle', 'done'].includes(masterStatus) ? 'cycle' : 'defer';
}

// What happens when a deferred agent's turn ends or it hits a permission prompt.
function pendingModeAction({ provider, eventType }) {
  if (provider === 'codex') return 'relaunch';
  return eventType === 'done' ? 'cycle' : 'relaunch';
}

const MASTER_PARTS = { applied: 'maître basculé', deferred: 'maître à la fin de son tour', failed: 'maître non basculé' };

function modeSummary(mode, agentOutcomes, masterOutcome) {
  const count = (kind) => agentOutcomes.filter((o) => o === kind).length;
  const parts = [];
  const applied = count('applied') + count('relaunched') + count('recorded');
  if (applied) parts.push(`${applied} agent${applied > 1 ? 's' : ''} mis à jour`);
  if (count('kept')) parts.push(`${count('kept')} gardent leur mode plus strict`);
  if (count('unchanged')) parts.push(`${count('unchanged')} déjà dans ce mode`);
  if (count('deferred')) parts.push(`${count('deferred')} à la fin de leur tour`);
  if (count('failed')) parts.push(`${count('failed')} en échec`);
  if (MASTER_PARTS[masterOutcome]) parts.push(MASTER_PARTS[masterOutcome]);
  const label = MODE_LABELS[mode] || mode;
  return parts.length ? `${label} (${parts.join(', ')})` : `${label} (aucun agent à mettre à jour)`;
}

module.exports = { MODE_RANK, MODE_CYCLE, isStricter, overrideError, MODE_LABELS, modeFromScreen, cyclePresses, agentModeAction, masterModeAction, pendingModeAction, modeSummary };
