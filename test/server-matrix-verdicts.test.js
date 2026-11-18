const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-verdicts-home-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

const matrix = require('../server/features/matrix');
const { MATRIX_MAINTAINER } = require('../server/config');

const finding = (n) => ({ id: `j1:F${n}`, type: 'finding', judge: { obs: 'j1', role: 'reviewer' }, target: { obs: 't1', category: 'implement' }, delivery: 1, severity: 'to-fix', text: 'x' });
const outcome = (value) => ({ id: 't1:outcome', type: 'outcome', pick: { obs: 't1', category: 'implement' }, outcome: value });

test('verdict records are stored once by id, an outcome replaces its predecessor', { skip: MATRIX_MAINTAINER }, () => {
  assert.deepStrictEqual(matrix.readVerdictRecords(), []);
  assert.strictEqual(matrix.appendVerdictRecords([finding(1), finding(2), outcome(null)]), 3);
  assert.strictEqual(matrix.appendVerdictRecords([finding(1), finding(2)]), 0, 're-capture is idempotent');
  assert.strictEqual(matrix.appendVerdictRecords([outcome('fixed'), { type: 'finding' }]), 1);
  const stored = matrix.readVerdictRecords();
  assert.deepStrictEqual(stored.map((r) => r.id).sort(), ['j1:F1', 'j1:F2', 't1:outcome']);
  assert.strictEqual(stored.find((r) => r.id === 't1:outcome').outcome, 'fixed');
});

test('launches earn a credit every fifth one, at most 2 banked, spent once each', () => {
  for (let i = 0; i < 4; i += 1) matrix.recordLaunch();
  assert.strictEqual(matrix.spendCredit(), false);
  assert.deepStrictEqual(matrix.recordLaunch(), { launches: 5, credits: 1, spent: 0 });
  assert.strictEqual(matrix.spendCredit(), true);
  assert.deepStrictEqual(matrix.readCoverage(), { launches: 5, credits: 0, spent: 1 });
  for (let i = 0; i < 15; i += 1) matrix.recordLaunch();
  assert.strictEqual(matrix.readCoverage().credits, 2);
});

test('a corrupted coverage file reads as zeros', () => {
  fs.writeFileSync(path.join(home, '.claude', 'worktree-matrix-coverage.json'), '{"launches":"x","credits":null}');
  assert.deepStrictEqual(matrix.readCoverage(), { launches: 0, credits: 0, spent: 0 });
  assert.deepStrictEqual(matrix.recordLaunch(), { launches: 1, credits: 0, spent: 0 });
});
