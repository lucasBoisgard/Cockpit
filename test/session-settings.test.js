const test = require('node:test');
const assert = require('node:assert');
const { modelOption, modelChoice, effortOption, effortChoice } = require('../web/js/session-settings');

test('modelOption maps ids and display names to the /model alias of their family', () => {
  assert.strictEqual(modelOption('claude-opus-5-5'), 'opus');
  assert.strictEqual(modelOption('claude-opus-5-5[1m]'), 'opus[1m]');
  assert.strictEqual(modelOption('us.anthropic.claude-sonnet-5-5-20261001-v1:0'), 'sonnet');
  assert.strictEqual(modelOption(null, 'Sonnet 5.5 (1M context)'), 'sonnet[1m]');
  assert.strictEqual(modelOption('claude-haiku-5-5[1m]'), 'haiku');
  assert.strictEqual(modelOption(null, 'Fable 5.1'), 'fable');
  assert.strictEqual(modelOption('gpt-x'), null);
  assert.strictEqual(modelOption(null, null), null);
});

test('modelChoice shows a pending choice until a newer snapshot reports it', () => {
  const usage = { modelId: 'claude-opus-5-5', model: 'Opus 5.5', at: 1000 };
  const pending = { value: 'sonnet', queued: false, at: 2000 };
  assert.strictEqual(modelChoice(usage, pending, 3000), 'sonnet');
  assert.strictEqual(modelChoice({ ...usage, at: 2500 }, pending, 3000), 'sonnet');
  assert.strictEqual(modelChoice({ modelId: 'claude-sonnet-5-5', at: 2500 }, pending, 3000), 'sonnet');
  assert.strictEqual(modelChoice(usage, pending, 2000 + 5 * 60000 + 1), 'opus');
  assert.strictEqual(modelChoice(usage, { ...pending, queued: true }, 2000 + 5 * 60000 + 1), 'sonnet');
});

test('modelChoice settles a default choice on the next snapshot and keeps unknown models visible', () => {
  assert.strictEqual(modelChoice({ modelId: 'claude-opus-5-5', at: 3000 }, { value: 'default', at: 2000 }, 3500), 'opus');
  assert.strictEqual(modelChoice({ modelId: 'mystery-1', at: 1 }, null, 2), 'other:mystery-1');
  assert.strictEqual(modelChoice(null, null, 2), '');
});

test('effortOption accepts the /effort levels only', () => {
  assert.strictEqual(effortOption('xhigh'), 'xhigh');
  assert.strictEqual(effortOption('HIGH'), 'high');
  assert.strictEqual(effortOption('turbo'), null);
  assert.strictEqual(effortOption(null), null);
});

test('effortChoice follows the status line and settles auto on the next snapshot', () => {
  assert.strictEqual(effortChoice({ effort: 'medium', at: 1 }, null, 2), 'medium');
  assert.strictEqual(effortChoice({ effort: 'medium', at: 1000 }, { value: 'max', at: 2000 }, 3000), 'max');
  assert.strictEqual(effortChoice({ effort: 'max', at: 2500 }, { value: 'max', at: 2000 }, 3000), 'max');
  assert.strictEqual(effortChoice({ effort: 'high', at: 2500 }, { value: 'auto', at: 2000 }, 3000), 'high');
  assert.strictEqual(effortChoice({ effort: 'turbo', at: 1 }, null, 2), 'other:turbo');
  assert.strictEqual(effortChoice({ at: 1 }, null, 2), '');
});
