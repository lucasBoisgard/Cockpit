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

test('cyclePresses counts Shift+Tab presses along acceptEdits, plan, auto, default', () => {
  assert.strictEqual(core.cyclePresses('acceptEdits', 'acceptEdits'), 0);
  assert.strictEqual(core.cyclePresses('acceptEdits', 'auto'), 2);
  assert.strictEqual(core.cyclePresses('auto', 'acceptEdits'), 2);
  assert.strictEqual(core.cyclePresses('default', 'acceptEdits'), 1);
  assert.strictEqual(core.cyclePresses('plan', 'default'), 2);
  assert.strictEqual(core.cyclePresses('bypass', 'auto'), null);
  assert.strictEqual(core.cyclePresses('auto', 'bypass'), null);
});

test('agentModeAction picks the safest way to reach each agent', () => {
  const claude = (status, permission) => core.agentModeAction({ provider: 'claude', status, permission });
  assert.strictEqual(claude('stopped'), 'record');
  assert.strictEqual(claude('working'), 'cycle');
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

test('the master is never restarted: its prompt is cycled, or the switch waits for its turn to end', () => {
  assert.strictEqual(core.masterModeAction('working'), 'cycle');
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
