const test = require('node:test');
const assert = require('node:assert');
const { createAlwaysAllow } = require('../server/features/always-allow');

function setup(overrides = {}) {
  const sent = [];
  const cycles = [];
  const deps = {
    readSession: (id) => (id === 'gone' ? null : { sessionId: id, provider: id === 'gpt' ? 'codex' : 'claude', ...(sent.length ? { status: 'working' } : { status: 'needs_input', permission: true }) }),
    sendOps: async (target, ops) => { sent.push([target, ops]); return {}; },
    cycleSessionMode: async (id, mode) => { cycles.push([id, mode]); return 'applied'; },
    switchTeamToAuto: async () => false,
    allowKey: { literal: '1' },
    retryMs: 1,
    ...overrides,
  };
  return { alwaysAllow: createAlwaysAllow(deps), sent, cycles };
}

const outcome = (alwaysAllow, args) => new Promise((resolve) => alwaysAllow({ ...args, done: resolve }));

test('an unknown session or a Codex session is refused before anything is pressed', async () => {
  const { alwaysAllow, sent } = setup();
  assert.match((await alwaysAllow({ target: 't', sessionId: 'gone' })).error, /inconnue/);
  assert.match((await alwaysAllow({ target: 't', sessionId: 'gpt' })).error, /Codex/);
  assert.deepStrictEqual(sent, []);
});

test('a plain session is answered with allow, then walked to auto', async () => {
  const { alwaysAllow, sent, cycles } = setup();
  let result;
  const done = new Promise((resolve) => { result = alwaysAllow({ target: 'pane1', sessionId: 's1', done: resolve }); });
  assert.deepStrictEqual(await result, { ok: true });
  assert.deepStrictEqual(sent, [['pane1', [{ literal: '1' }]]]);
  assert.strictEqual(await done, 'applied');
  assert.deepStrictEqual(cycles, [['s1', 'auto']]);
});

test('a member of an orchestration takes its whole team to auto and is not cycled alone', async () => {
  const { alwaysAllow, cycles } = setup({ switchTeamToAuto: async () => true });
  assert.strictEqual(await outcome(alwaysAllow, { target: 't', sessionId: 's1' }), 'team');
  assert.deepStrictEqual(cycles, []);
});

test('a session that is still working is retried until its prompt is idle', async () => {
  const answers = ['busy', 'busy', 'applied'];
  const cycles = [];
  const { alwaysAllow } = setup({ cycleSessionMode: async (id, mode) => { cycles.push([id, mode]); return answers.shift(); } });
  assert.strictEqual(await outcome(alwaysAllow, { target: 't', sessionId: 's1' }), 'applied');
  assert.strictEqual(cycles.length, 3);
});

test('a failed key press reports the error and never switches the mode', async () => {
  const { alwaysAllow, cycles } = setup({ sendOps: async () => ({ error: 'offline' }) });
  assert.deepStrictEqual(await alwaysAllow({ target: 't', sessionId: 's1' }), { error: 'offline' });
  assert.deepStrictEqual(cycles, []);
});

test('a session that is not asking for a permission is refused, nothing is pressed', async () => {
  const { alwaysAllow, sent } = setup({ readSession: () => ({ sessionId: 's1', provider: 'claude', status: 'idle' }) });
  assert.match((await alwaysAllow({ target: 't', sessionId: 's1' })).error, /Aucune permission en attente/);
  assert.deepStrictEqual(sent, []);
});

test('the mode is only switched once the allowed command is over, never while the prompt is still open', async () => {
  let asking = 3;
  const cycles = [];
  const { alwaysAllow } = setup({
    readSession: () => ({ sessionId: 's1', provider: 'claude', status: asking-- > 0 ? 'needs_input' : 'working', permission: asking > 0 }),
    cycleSessionMode: async (id, mode) => { cycles.push([id, mode, asking]); return 'applied'; },
    switchTeamToAuto: async () => { assert.ok(asking <= 0, 'team switched while the prompt was open'); return true; },
  });
  assert.strictEqual(await outcome(alwaysAllow, { target: 't', sessionId: 's1' }), 'team');
});

test('nothing is switched when the session ends before its prompt clears', async () => {
  let calls = 0;
  const { alwaysAllow, cycles } = setup({
    readSession: () => (calls++ < 1 ? { sessionId: 's1', provider: 'claude', status: 'needs_input', permission: true } : { sessionId: 's1', provider: 'claude', status: 'ended' }),
  });
  assert.strictEqual(await outcome(alwaysAllow, { target: 't', sessionId: 's1' }), 'skipped');
  assert.deepStrictEqual(cycles, []);
});
