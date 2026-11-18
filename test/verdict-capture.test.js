const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../server/core/verdict-capture');

const orch = { agents: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3', parentId: 'w1', obs: 'o3', kind: 'review', provider: 'codex', model: 'gpt', effort: 'low', missions: [{ role: 'reviewer', targets: ['w1'] }], deliveries: 2 }] };

test('missions: roles, targets and self are validated', () => {
  assert.deepEqual(c.parseMissions(['reviewer:w1,w2', 'judge:w1'], orch).missions, [{ role: 'reviewer', targets: ['w1', 'w2'] }, { role: 'judge', targets: ['w1'] }]);
  assert.match(c.parseMissions(['boss:w1'], orch).error, /inconnu/);
  assert.match(c.parseMissions(['reviewer:w9'], orch).error, /w9/);
  assert.match(c.parseMissions(['reviewer:w1'], orch, 'w1').error, /lui-même/);
  assert.match(c.parseMissions(['reviewer:'], orch).error, /Donne/);
  assert.deepEqual(c.parseMissions(undefined, orch).missions, []);
});

test('missions merge per role without duplicates', () => {
  assert.deepEqual(c.mergeMissions([{ role: 'reviewer', targets: ['w1'] }], [{ role: 'reviewer', targets: ['w1', 'w2'] }, { role: 'judge', targets: ['w3'] }]), [{ role: 'reviewer', targets: ['w1', 'w2'] }, { role: 'judge', targets: ['w3'] }]);
  assert.equal(c.missionText([{ role: 'reviewer', targets: ['w1', 'w2'] }]), 'reviewer:w1,w2');
});

test('obs is 32 hex chars', () => {
  assert.match(c.newObs((n) => Buffer.alloc(n, 171)), /^[0-9a-f]{32}$/);
});

test('capture context: writer, its missions, picks, parents and deliveries by agent id', () => {
  const ctx = c.captureContext(orch, orch.agents[2], [{ id: 'r' }]);
  assert.deepEqual(ctx.writer, { obs: 'o3', agent: 'w3', category: 'review', provider: 'codex', model: 'gpt', effort: 'low' });
  assert.deepEqual(ctx.missions, [{ role: 'reviewer', targets: ['w1'] }]);
  assert.deepEqual(ctx.parentOf, { w3: 'w1' });
  assert.deepEqual(ctx.deliveries, { w1: 0, w2: 0, w3: 2 });
  assert.equal(ctx.agents.w1.agent, 'w1');
  assert.deepEqual(ctx.records, [{ id: 'r' }]);
});

test('wake lines: findings per target, clean, triages, rejected lines with reason', () => {
  const finding = (id) => ({ type: 'finding', target: { agent: id } });
  const lines = c.verdictWakeLines([finding('w1'), finding('w1'), { type: 'clean', target: { agent: 'w2' } }, { type: 'triage' }, { type: 'triage' }], [{ reason: "w2 n'est pas dans ta mission" }]);
  assert.deepEqual(lines, ['Verdicts : 2 constats sur w1, w2 propre, 2 triages', "Ligne ignorée : w2 n'est pas dans ta mission"]);
  assert.deepEqual(c.verdictWakeLines([], []), []);
  assert.deepEqual(c.verdictWakeLines([finding('w1')]), ['Verdicts : 1 constat sur w1']);
});

test('outcome record: stable id, counters and measure', () => {
  const rec = c.outcomeRecord({ id: 'w1', obs: 'o1', rounds: 2, deliveries: 3, explore: true }, { outcome: 'fixed', note: 'x'.repeat(400), measure: { tokens: 5, durationMs: 9 } });
  assert.equal(rec.id, 'o1:outcome');
  assert.equal(rec.note.length, 300);
  assert.deepEqual([rec.rounds, rec.deliveries, rec.explore, rec.tokens, rec.durationMs], [2, 3, true, 5, 9]);
  assert.equal(c.outcomeRecord({ id: 'w2', obs: 'o2' }, { outcome: null }).outcome, null);
  assert.equal(c.validateOutcome('as-is').outcome, 'as-is');
  assert.ok(c.validateOutcome('great').error);
});
