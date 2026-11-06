const test = require('node:test');
const assert = require('node:assert');
const core = require('../server/core/permission-mode');

const footer = (line) => `❯ \n──────\n  🌳 main · feat/x · Opus 5.5   0 tokens\n  ${line}`;

test('modeFromScreen reads the mode in the footer and nothing when a dialog hides it', () => {
  assert.strictEqual(core.modeFromScreen(footer('⏵⏵ auto mode on (shift+tab to cycle)')), 'auto');
  assert.strictEqual(core.modeFromScreen(footer('⏵⏵ accept edits on (shift+tab to cycle) · ← for agents')), 'acceptEdits');
  assert.strictEqual(core.modeFromScreen(footer('⏸ plan mode on (shift+tab to cycle)')), 'plan');
  assert.strictEqual(core.modeFromScreen(footer('⏸ manual mode on · 1 shell')), 'default');
  assert.strictEqual(core.modeFromScreen(footer('? for shortcuts')), 'default');
  assert.strictEqual(core.modeFromScreen(footer('⏵⏵ bypass permissions on')), 'bypass');
  assert.strictEqual(core.modeFromScreen(' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel · Tab to amend'), null);
  assert.strictEqual(core.modeFromScreen(''), null);
  assert.strictEqual(core.modeFromScreen('\x1b[2m⏵⏵ auto mode on\x1b[0m'), 'auto');
});

test('modeFromScreen prefers the footer over older text that mentions another mode', () => {
  const screen = `● the plan mode on switch was added\n${footer('⏵⏵ auto mode on (shift+tab to cycle)')}`;
  assert.strictEqual(core.modeFromScreen(screen), 'auto');
});

test('agentModeAction picks the safest way to reach each agent', () => {
  const claude = (status, permission) => core.agentModeAction({ provider: 'claude', status, permission });
  assert.strictEqual(claude('stopped'), 'record');
  assert.strictEqual(claude('working'), 'defer');
  assert.strictEqual(claude('done'), 'cycle');
  assert.strictEqual(claude('needs', true), 'relaunch');
  assert.strictEqual(claude('needs', false), 'defer');
  assert.strictEqual(claude('starting'), 'defer');
  const codex = (status) => core.agentModeAction({ provider: 'codex', status });
  assert.strictEqual(codex('stopped'), 'record');
  assert.strictEqual(codex('working'), 'defer');
  assert.strictEqual(codex('starting'), 'defer');
  assert.strictEqual(codex('needs'), 'relaunch');
  assert.strictEqual(codex('done'), 'relaunch');
});

test('the master is never restarted: its prompt is cycled once idle, or the switch waits for its turn to end', () => {
  assert.strictEqual(core.masterModeAction('working'), 'defer');
  assert.strictEqual(core.masterModeAction('idle'), 'cycle');
  assert.strictEqual(core.masterModeAction('done'), 'cycle');
  assert.strictEqual(core.masterModeAction('needs_input'), 'defer');
  assert.strictEqual(core.masterModeAction('ended'), 'record');
});

test('pendingModeAction cycles a Claude prompt at the end of its turn and relaunches behind a permission prompt', () => {
  assert.strictEqual(core.pendingModeAction({ provider: 'claude', eventType: 'done' }), 'cycle');
  assert.strictEqual(core.pendingModeAction({ provider: 'claude', eventType: 'permission' }), 'relaunch');
  assert.strictEqual(core.pendingModeAction({ provider: 'codex', eventType: 'done' }), 'relaunch');
});

test('modeSummary counts what happened to each agent and to the master', () => {
  assert.strictEqual(core.modeSummary('auto', ['applied', 'relaunched', 'recorded', 'unchanged', 'deferred', 'failed'], 'applied'), 'auto (3 agents mis à jour, 1 déjà dans ce mode, 1 à la fin de leur tour, 1 en échec, maître basculé)');
  assert.strictEqual(core.modeSummary('plan', ['applied'], 'unchanged'), 'plan (1 agent mis à jour)');
  assert.strictEqual(core.modeSummary('default', [], 'recorded'), 'par défaut (aucun agent à mettre à jour)');
  assert.strictEqual(core.modeSummary('auto', ['unchanged'], 'deferred'), 'auto (1 déjà dans ce mode, maître à la fin de son tour)');
});

test('overrideError lets an agent be stricter than its orchestration, never looser', () => {
  assert.strictEqual(core.overrideError('plan', 'auto'), null);
  assert.strictEqual(core.overrideError('plan', 'acceptEdits'), null);
  assert.strictEqual(core.overrideError('default', 'acceptEdits'), null);
  assert.strictEqual(core.overrideError('acceptEdits', 'acceptEdits'), null);
  assert.strictEqual(core.overrideError(null, 'plan'), null);
  assert.match(core.overrideError('auto', 'acceptEdits'), /refusé/);
  assert.match(core.overrideError('acceptEdits', 'default'), /refusé/);
  assert.match(core.overrideError('default', 'plan'), /aucun mode plus strict/);
});

test('effectiveMode keeps the stricter launch override and follows a stricter setting', () => {
  assert.strictEqual(core.effectiveMode({ modeOverride: 'plan' }, 'auto'), 'plan');
  assert.strictEqual(core.effectiveMode({ modeOverride: 'default' }, 'plan'), 'plan');
  assert.strictEqual(core.effectiveMode({ modeOverride: 'default' }, 'default'), 'default');
  assert.strictEqual(core.effectiveMode({}, 'auto'), 'auto');
  assert.strictEqual(core.modeSummary('auto', ['kept', 'applied'], null), 'auto (1 agent mis à jour, 1 gardent leur mode plus strict)');
});

// A simulated prompt: Shift+Tab moves along `cycle`, the footer shows the mode.
function prompt(cycle, start, { idleAfter = Infinity, hideAfter = Infinity } = {}) {
  const state = { index: cycle.indexOf(start), presses: 0, reads: 0 };
  return {
    state,
    io: {
      read: async () => (++state.reads > hideAfter ? null : cycle[state.index]),
      press: async () => { state.presses++; state.index = (state.index + 1) % cycle.length; },
      idle: async () => state.presses < idleAfter,
    },
  };
}
const CYCLE = ['default', 'acceptEdits', 'plan', 'auto'];

test('cycleToMode presses once at a time up to the target', async () => {
  const p = prompt(CYCLE, 'acceptEdits');
  assert.strictEqual(await core.cycleToMode(p.io, 'auto'), 'applied');
  assert.strictEqual(p.state.presses, 2);
  assert.strictEqual(await core.cycleToMode(p.io, 'auto'), 'unchanged');
  assert.strictEqual(p.state.presses, 2);
});

test('cycleToMode gives up when the target is not in the cycle, back on the mode it started from', async () => {
  const p = prompt(['default', 'acceptEdits', 'plan'], 'acceptEdits');
  assert.strictEqual(await core.cycleToMode(p.io, 'auto'), 'unreachable');
  assert.strictEqual(p.state.presses, 3);
  assert.strictEqual(p.io.read && (await p.io.read()), 'acceptEdits');
});

test('cycleToMode never rests on bypass', async () => {
  const withBypass = ['default', 'acceptEdits', 'plan', 'bypass'];
  const toDefault = prompt(withBypass, 'acceptEdits');
  assert.strictEqual(await core.cycleToMode(toDefault.io, 'default'), 'applied');
  assert.strictEqual(await toDefault.io.read(), 'default');
  const missing = prompt(withBypass, 'plan');
  assert.strictEqual(await core.cycleToMode(missing.io, 'auto'), 'unreachable');
  assert.strictEqual(await missing.io.read(), 'plan');
  const fromBypass = prompt(withBypass, 'bypass');
  assert.strictEqual(await core.cycleToMode(fromBypass.io, 'acceptEdits'), 'applied');
  const stuck = prompt(withBypass, 'bypass');
  assert.notStrictEqual(await core.cycleToMode(stuck.io, 'auto'), 'applied');
  assert.notStrictEqual(await stuck.io.read(), 'bypass');
});

test('cycleToMode stops as soon as the prompt is no longer idle or shows no mode, and says when it left a mode half way', async () => {
  const busyFirst = prompt(CYCLE, 'default', { idleAfter: 0 });
  assert.strictEqual(await core.cycleToMode(busyFirst.io, 'auto'), 'busy');
  assert.strictEqual(busyFirst.state.presses, 0);
  const busy = prompt(CYCLE, 'default', { idleAfter: 1 });
  assert.strictEqual(await core.cycleToMode(busy.io, 'auto'), 'interrupted');
  assert.strictEqual(busy.state.presses, 1);
  const dialog = prompt(CYCLE, 'default', { hideAfter: 1 });
  assert.strictEqual(await core.cycleToMode(dialog.io, 'auto'), 'interrupted');
  assert.strictEqual(dialog.state.presses, 1);
  const unreadable = prompt(CYCLE, 'default', { hideAfter: 0 });
  assert.strictEqual(await core.cycleToMode(unreadable.io, 'auto'), 'unreadable');
  assert.strictEqual(unreadable.state.presses, 0);
});
