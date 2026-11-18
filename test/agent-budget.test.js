const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('../server/core/agent-budget');
const { normalizeSettings, wakeText, doneWakeText, tokenBudget } = require('../server/core/orchestration');

test('over budget only strictly above the budget, never when the budget is 0', () => {
  assert.equal(b.budgetState(15e6, 15).over, false);
  assert.equal(b.budgetState(15e6 + 1, 15).over, true);
  assert.equal(b.budgetState(900e6, 0).over, false);
  assert.equal(b.budgetState(undefined, 15).tokens, 0);
});

test('labels and messages', () => {
  const s = b.budgetState(18.2e6, 15);
  assert.equal(b.overBudgetLabel(s), '18,2 M tok > budget 15 M');
  assert.match(b.wakeBudgetLine('w3', s), /agent neuf.*passage de relais/);
  assert.match(b.budgetWarning('w3', s), /^⚠ w3 a consommé 18,2 M tok > budget 15 M/);
});

test('wake text adds the budget line only when given', () => {
  const agent = { id: 'w3', name: 'x' };
  assert.doesNotMatch(wakeText(agent, 'done', 'ok'), /Budget/);
  assert.match(wakeText(agent, 'done', 'ok', 'LIGNE'), /LIGNE/);
});

test('setting agentTokenBudget: default, bounds, zero disables', () => {
  assert.equal(normalizeSettings({}).settings.agentTokenBudget, 15);
  assert.equal(normalizeSettings({ agentTokenBudget: '30' }).settings.agentTokenBudget, 30);
  assert.equal(normalizeSettings({ agentTokenBudget: 0 }).settings.agentTokenBudget, 0);
  assert.ok(normalizeSettings({ agentTokenBudget: -1 }).error);
  assert.ok(normalizeSettings({ agentTokenBudget: 9999 }).error);
});

test('done wake: budget line only past the budget, default applies when the setting is missing', () => {
  const agent = { id: 'w3', name: 'x' };
  assert.match(doneWakeText(agent, 'ok', 18e6, { agentTokenBudget: 15 }), /Budget dépassé \(18 M tok > budget 15 M\)/);
  assert.doesNotMatch(doneWakeText(agent, 'ok', 10e6, { agentTokenBudget: 15 }), /Budget/);
  assert.match(doneWakeText(agent, 'ok', 16e6, {}), /Budget dépassé/);
  assert.doesNotMatch(doneWakeText(agent, 'ok', 900e6, { agentTokenBudget: 0 }), /Budget/);
});

test('settings without the field: default budget, and normalizeSettings keeps the base value', () => {
  assert.equal(tokenBudget({ maxAgents: 3 }), 15);
  assert.equal(normalizeSettings({ maxAgents: 4 }, { maxAgents: 3 }).settings.agentTokenBudget, 15);
  assert.equal(normalizeSettings({ maxAgents: 4 }, { agentTokenBudget: 30 }).settings.agentTokenBudget, 30);
});

test('session index: built inline once, then only refreshed in the background once a minute', () => {
  const { indexAction, SESSION_INDEX_TTL_MS } = require('../server/core/session-index');
  assert.equal(indexAction({ builtAt: null, building: false, now: 1e6 }), 'build-now');
  assert.equal(indexAction({ builtAt: 1e6, building: false, now: 1e6 + SESSION_INDEX_TTL_MS }), 'use');
  assert.equal(indexAction({ builtAt: 1e6, building: false, now: 1e6 + SESSION_INDEX_TTL_MS + 1 }), 'rebuild-later');
  assert.equal(indexAction({ builtAt: 1e6, building: true, now: 1e9 }), 'use');
});
