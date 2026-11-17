const test = require('node:test');
const assert = require('node:assert');
const { parseOptions, answerOps } = require('../server/core/permission-dialog');

const numbered = `
 A variable in this command can't be checked before it runs

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and switch to auto mode · auto mode handles these prompts for you
   3. No

 Esc to cancel · Tab to amend`;

const toolConfirm = `
 Permanently delete "Example"?

 ❯ No
   Yes

 Esc to cancel · Tab to amend`;

test('a numbered dialog lists its options with their numbers', () => {
  assert.deepStrictEqual(parseOptions(numbered).map((o) => [o.number, o.label.slice(0, 12), o.selected]), [[1, 'Yes', true], [2, 'Yes, and swi', false], [3, 'No', false]]);
});

test('allow presses the number of the plain Yes, deny the number of No', () => {
  assert.deepStrictEqual(answerOps(numbered, 'allow'), [{ literal: '1' }]);
  assert.deepStrictEqual(answerOps(numbered, 'deny'), [{ literal: '3' }]);
});

test('a dialog without numbers where No comes first is answered with the arrows and Enter, never with a digit', () => {
  assert.deepStrictEqual(parseOptions(toolConfirm).map((o) => [o.number, o.label, o.selected]), [[null, 'No', true], [null, 'Yes', false]]);
  assert.deepStrictEqual(answerOps(toolConfirm, 'allow'), [{ key: 'Down' }, { key: 'Enter' }]);
  assert.deepStrictEqual(answerOps(toolConfirm, 'deny'), [{ key: 'Enter' }]);
});

test('colours and a selected last option are handled', () => {
  const coloured = '\x1b[1m Delete it?\x1b[0m\n\n   Yes\n \x1b[36m❯ No\x1b[0m\n\n Esc to cancel';
  assert.deepStrictEqual(answerOps(coloured, 'allow'), [{ key: 'Up' }, { key: 'Enter' }]);
});

test('no dialog or no Yes option gives null so the caller keeps the provider keys', () => {
  assert.strictEqual(answerOps('just a prompt\n> ', 'allow'), null);
  assert.strictEqual(answerOps(' Pick one?\n\n ❯ Red\n   Blue\n\n Esc to cancel', 'allow'), null);
  assert.deepStrictEqual(parseOptions(''), []);
});

const { createPermissionAnswer } = require('../server/features/permission-answer');

test('a stale footer in the scrollback, with no dialog at the bottom, is ignored', () => {
  const stale = `${toolConfirm}\n${'● Done\n'.repeat(10)}\n> `;
  assert.deepStrictEqual(parseOptions(stale), []);
  assert.strictEqual(answerOps(stale, 'allow'), null);
});

test('footer variants are recognized, and a dialog not drawn last is read from the bottom', () => {
  assert.deepStrictEqual(answerOps(toolConfirm.replace('Esc to cancel · Tab to amend', 'Enter to confirm · Esc to exit'), 'allow'), [{ key: 'Down' }, { key: 'Enter' }]);
  assert.deepStrictEqual(answerOps(`${'noise\n'.repeat(30)}${toolConfirm}\n status line`, 'allow'), [{ key: 'Down' }, { key: 'Enter' }]);
});

test('without a highlighted option, with misaligned options or with odd numbering nothing is pressed', () => {
  assert.strictEqual(answerOps(' Delete?\n\n   No\n   Yes\n\n Esc to cancel', 'allow'), null);
  assert.strictEqual(answerOps(' Delete?\n\n ❯ No\n    Yes\n\n Esc to cancel', 'allow'), null);
  assert.strictEqual(answerOps(' Delete?\n\n ❯ 1. Yes\n   3. No\n\n Esc to cancel', 'allow'), null);
});

test('a wrapped label is one option, so the arrow count stays right', () => {
  const wrapped = ' Delete it?\n\n ❯ No, keep it and tell Claude\n     what to do differently\n   Yes\n\n Esc to cancel';
  assert.deepStrictEqual(parseOptions(wrapped).map((o) => o.label), ['No, keep it and tell Claude what to do differently', 'Yes']);
  assert.deepStrictEqual(answerOps(wrapped, 'allow'), [{ key: 'Down' }, { key: 'Enter' }]);
});

test('only the exact Yes or No is chosen, never a variant that grants more', () => {
  const edits = ' Edit this file?\n\n ❯ 1. Yes, allow all edits during this session\n   2. No\n\n Esc to cancel';
  assert.strictEqual(answerOps(edits, 'allow'), null);
  assert.deepStrictEqual(answerOps(edits, 'deny'), [{ literal: '2' }]);
  assert.strictEqual(answerOps(' Pick?\n\n ❯ [ ] Foo\n   [ ] Bar\n\n Esc to cancel', 'allow'), null);
});

function answerer({ session, text, sent = [] }) {
  return {
    sent,
    answer: createPermissionAnswer({
      readSession: () => session,
      screen: async () => text,
      sendOps: async (target, ops) => { sent.push(['ops', target, ops]); return { ok: true }; },
      sendNamedKeys: async (target, keys) => { sent.push(['keys', target, keys]); return { ok: true }; },
    }),
  };
}
const asking = { provider: 'claude', status: 'needs_input', permission: true };

test('an answer sends the arrows and Enter in one call, or the digit', async () => {
  const a = answerer({ session: asking, text: toolConfirm });
  assert.deepStrictEqual(await a.answer({ target: 't', sessionId: 's', decision: 'allow' }), { ok: true });
  assert.deepStrictEqual(a.sent, [['keys', 't', ['Down', 'Enter']]]);
  const b = answerer({ session: asking, text: numbered });
  await b.answer({ target: 't', sessionId: 's', decision: 'deny' });
  assert.deepStrictEqual(b.sent, [['ops', 't', [{ literal: '3' }]]]);
});

test('nothing is pressed for an unreadable or unknown screen, a Codex session or a session that is not asking', async () => {
  for (const [session, text, pattern] of [[asking, null, /non reconnu/], [asking, 'plain prompt\n> ', /non reconnu/], [{ ...asking, provider: 'codex' }, toolConfirm, /Codex/], [{ ...asking, status: 'working' }, toolConfirm, /Aucune permission/], [null, toolConfirm, /inconnue/]]) {
    const a = answerer({ session, text });
    assert.match((await a.answer({ target: 't', sessionId: 's', decision: 'allow' })).error, pattern);
    assert.deepStrictEqual(a.sent, []);
  }
});
