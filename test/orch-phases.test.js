const test = require('node:test');
const assert = require('node:assert');
const { orchActivePhases, orchActivePhasesLabel, orchActivePhasesDetail, orchActivePhasesShort } = require('../web/js/orch-phases');

const orch = (extra = {}) => ({ phases: ['Cadrer', 'Coder', 'Revoir', 'Livrer'], phase: 1, ...extra });

test('no plan: nothing active and the plan placeholder', () => {
  assert.deepStrictEqual(orchActivePhases(orch({ phases: [] })), []);
  assert.strictEqual(orchActivePhasesLabel(orch({ phases: [] })), 'Pas encore de plan');
  assert.strictEqual(orchActivePhasesShort(orch({ phases: [] })), 'sans plan');
});

test('detail without a plan', () => {
  assert.strictEqual(orchActivePhasesDetail(orch({ phases: [] })), 'pas de plan');
});

test('one active phase keeps the single-phase wording', () => {
  assert.strictEqual(orchActivePhasesLabel(orch({ activePhases: [2] })), 'Phase 3/4 · Revoir');
  assert.strictEqual(orchActivePhasesDetail(orch({ activePhases: [2] })), '3/4 · Revoir');
  assert.strictEqual(orchActivePhasesShort(orch({ activePhases: [2] })), 'Revoir');
});

test('old payload without activePhases falls back to phase', () => {
  assert.strictEqual(orchActivePhasesLabel(orch()), 'Phase 2/4 · Coder');
});

test('several active phases are listed 1-based, sorted and deduplicated', () => {
  const o = orch({ activePhases: [2, 1, 1] });
  assert.strictEqual(orchActivePhasesLabel(o), 'Phases 2 · 3 en parallèle');
  assert.strictEqual(orchActivePhasesDetail(o), '2 · 3 en parallèle (sur 4)');
  assert.strictEqual(orchActivePhasesShort(o), 'phases 2 · 3');
});

test('indices beyond the plan sit in the last phase, then deduplicated', () => {
  assert.strictEqual(orchActivePhasesLabel(orch({ activePhases: [1, 7] })), 'Phases 2 · 4 en parallèle');
  assert.strictEqual(orchActivePhasesLabel(orch({ activePhases: [3, 9] })), 'Phase 4/4 · Livrer');
  assert.deepStrictEqual(orchActivePhases(orch({ phases: ['A', 'B'], phase: 0, activePhases: [0, 4] })), [0, 1]);
});

test('empty activePhases falls back to the clamped phase', () => {
  assert.strictEqual(orchActivePhasesLabel(orch({ activePhases: [], phase: 3 })), 'Phase 4/4 · Livrer');
  assert.strictEqual(orchActivePhasesLabel(orch({ activePhases: [], phase: 9 })), 'Phase 4/4 · Livrer');
});

test('phase undefined falls back to the first phase', () => {
  assert.strictEqual(orchActivePhasesLabel(orch({ activePhases: [], phase: undefined })), 'Phase 1/4 · Cadrer');
  assert.strictEqual(orchActivePhasesLabel({ phases: ['A'] }), 'Phase 1/1 · A');
});
