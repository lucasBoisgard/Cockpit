const test = require('node:test');
const assert = require('node:assert');
const { limitPercent, highestUsage, arenaBlock, blockReason, refusalText } = require('../server/core/arena-breaker');

const NOW = 1000 * 1000;
const w = (used, resetsAt = NOW / 1000 + 3600) => ({ used_percentage: used, resets_at: resetsAt });

test('the threshold defaults to 75 and rejects nonsense', () => {
  assert.strictEqual(limitPercent(undefined), 75);
  assert.strictEqual(limitPercent('abc'), 75);
  assert.strictEqual(limitPercent(0), 75);
  assert.strictEqual(limitPercent(150), 75);
  assert.strictEqual(limitPercent(60), 60);
});

test('the fullest window among providers wins', () => {
  const top = highestUsage({ claude: { five_hour: w(40), seven_day: w(20) }, codex: { five_hour: w(80), seven_day: w(10) } }, NOW);
  assert.deepStrictEqual(top, { provider: 'codex', window: 'five_hour', percent: 80 });
});

test('a window already reset is ignored', () => {
  const limits = { claude: { five_hour: w(95, NOW / 1000 - 1), seven_day: w(20) } };
  assert.strictEqual(highestUsage(limits, NOW).percent, 20);
});

test('absent or empty limits give no reading and no block', () => {
  assert.strictEqual(highestUsage(null, NOW), null);
  assert.strictEqual(highestUsage({ claude: null, codex: null }, NOW), null);
  assert.strictEqual(arenaBlock({ claude: null, codex: null }, 75, NOW), null);
});

test('the block starts exactly at the threshold', () => {
  assert.strictEqual(arenaBlock({ claude: { five_hour: w(74.9) } }, 75, NOW), null);
  assert.deepStrictEqual(arenaBlock({ claude: { five_hour: w(75) } }, 75, NOW), { provider: 'claude', window: 'five_hour', percent: 75, threshold: 75 });
});

test('the messages name the provider, the window, the percentage and the threshold', () => {
  const block = arenaBlock({ claude: { five_hour: w(76) } }, 75, NOW);
  assert.strictEqual(blockReason(block), 'utilisation Claude (5 h) à 76 %, seuil de 75 % atteint');
  assert.match(refusalText(block), /^Mode Arène refusé : utilisation Claude \(5 h\) à 76 %/);
});

test('a provider report older than the window is ignored, even without a reset time', () => {
  const stale = { claude: { five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 20 }, at: NOW - 5 * 3600000 - 1 } };
  assert.deepStrictEqual(highestUsage(stale, NOW), { provider: 'claude', window: 'seven_day', percent: 20 });
  assert.strictEqual(arenaBlock({ claude: { five_hour: { used_percentage: 95 }, at: NOW - 6 * 3600000 } }, 75, NOW), null);
  assert.strictEqual(highestUsage({ claude: { seven_day: { used_percentage: 90 }, at: NOW - 7 * 86400000 - 1 } }, NOW), null);
});

test('a recent report without a reset time still counts', () => {
  assert.strictEqual(highestUsage({ claude: { five_hour: { used_percentage: 90 }, at: NOW - 3600000 } }, NOW).percent, 90);
});
