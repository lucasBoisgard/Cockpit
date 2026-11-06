// Pure decisions of the permission-mode propagation: reading the mode of a Claude Code session from its
// screen, walking the Shift+Tab cycle to another mode, and what to do for each kind of session.

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

// Walks a Claude Code prompt to `target` with one Shift+Tab at a time, reading the footer after each press.
// The cycle differs between sessions (auto may be missing, bypass may be present), so it stops at the target,
// or as soon as a mode comes back (the target is not in this cycle) and then never rests on bypass.
// `io`: read() the current mode, press(), idle() whether the session is still at an idle prompt.
// 'busy' and 'unreadable' mean nothing was pressed; 'interrupted' means the walk stopped half way, which
// leaves the session in an intermediate mode.
async function cycleToMode(io, target, maxSteps = 8) {
  const seen = new Set();
  let current = await io.read();
  for (let step = 0; step < maxSteps; step++) {
    if (!current) return step ? 'interrupted' : 'unreadable';
    if (current === target) return step ? 'applied' : 'unchanged';
    if (current !== 'bypass') {
      if (seen.has(current)) return 'unreachable';
      seen.add(current);
    }
    if (!(await io.idle())) return step ? 'interrupted' : 'busy';
    await io.press();
    current = await io.read();
  }
  return current === target ? 'applied' : 'failed';
}

const isStricter = (a, b) => MODE_RANK.indexOf(a) < MODE_RANK.indexOf(b);

// An explicit mode at launch is accepted only when it is not more permissive than the orchestration's.
function overrideError(requested, inherited) {
  if (!requested || MODE_RANK.indexOf(requested) < 0 || MODE_RANK.indexOf(inherited) < 0) return null;
  return isStricter(inherited, requested) ? `Mode ${requested} refusé : l'orchestration est en ${MODE_LABELS[inherited]}, un agent ne peut qu'être plus strict (${MODE_RANK.slice(0, MODE_RANK.indexOf(inherited)).join(', ') || 'aucun mode plus strict'}).` : null;
}

// What a new mode means for one agent, from its provider and status:
//  - record: nothing runs, the stored mode is what the next resume uses;
//  - cycle: an idle Claude prompt takes Shift+Tab, never one that works (a dialog may open under the keys);
//  - relaunch: restart with --resume and the new mode, keeping the conversation;
//  - defer: no safe move now, applied when its turn ends.
function agentModeAction({ provider, status, permission }) {
  if (status === 'stopped') return 'record';
  if (provider === 'codex') return status === 'needs' || status === 'done' ? 'relaunch' : 'defer';
  if (status === 'done') return 'cycle';
  if (status === 'needs' && permission) return 'relaunch';
  return 'defer';
}

// The master is never restarted: it runs the orchestration. Its prompt takes Shift+Tab once its turn is over.
function masterModeAction(masterStatus) {
  if (masterStatus === 'ended') return 'record';
  return ['idle', 'done'].includes(masterStatus) ? 'cycle' : 'defer';
}

// The mode an agent ends up in: its stricter launch override survives a looser orchestration mode.
function effectiveMode(agent, mode) {
  return agent.modeOverride && isStricter(agent.modeOverride, mode) ? agent.modeOverride : mode;
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

module.exports = { MODE_RANK, isStricter, overrideError, effectiveMode, MODE_LABELS, modeFromScreen, cycleToMode, agentModeAction, masterModeAction, pendingModeAction, modeSummary };
