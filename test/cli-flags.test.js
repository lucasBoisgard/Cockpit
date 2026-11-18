const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFlags } = require('../server/core/cli-flags');

test('launch flags: value flags, repeated --skill and --verifies, boolean --isolated and --explore', () => {
  const { flags, rest } = parseFlags(['--name', 'review', '--kind', 'review', '--skill', 'a', '--skill', 'b', '--verifies', 'reviewer:w1,w2', '--verifies', 'judge:w3', '--explore', '--isolated']);
  assert.equal(flags.name, 'review');
  assert.deepEqual(flags.skills, ['a', 'b']);
  assert.deepEqual(flags.verifies, ['reviewer:w1,w2', 'judge:w3']);
  assert.equal(flags.explore, true);
  assert.equal(flags.isolated, true);
  assert.deepEqual(rest, []);
});

test('send --info takes the message, --capture takes an id, positional words stay in rest', () => {
  assert.equal(parseFlags(['w3', '--info', 'scope added']).flags.info, 'scope added');
  assert.equal(parseFlags(['--capture', 'w4']).flags.capture, 'w4');
  assert.deepEqual(parseFlags(['w3', 'fixed', 'a note']).rest, ['w3', 'fixed', 'a note']);
});

test('no flag leaves the defaults empty', () => {
  const { flags } = parseFlags([]);
  assert.deepEqual([flags.skills, flags.verifies, flags.explore], [[], [], undefined]);
});

test('--info at the end of the line stands alone, a value flag without value is an error', () => {
  const { flags, rest, errors } = parseFlags(['w3', 'scope added', '--info']);
  assert.equal(flags.info, true);
  assert.deepEqual(rest, ['w3', 'scope added']);
  assert.deepEqual(errors, []);
  assert.deepEqual(parseFlags(['--capture']).errors, ['Valeur manquante pour --capture.']);
  assert.deepEqual(parseFlags(['--name', 'a', '--verifies']).errors, ['Valeur manquante pour --verifies.']);
});
