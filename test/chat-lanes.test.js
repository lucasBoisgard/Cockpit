const test = require('node:test');
const assert = require('node:assert');
const { assignLanes, isCockpitMessage, milestoneBody } = require('../server/core/chat-lanes');

const user = (text) => ({ kind: 'user', text });
const reply = (text) => ({ kind: 'assistant', text });
const tool = () => ({ kind: 'tool', tool: 'Bash', detail: 'ls' });
const lanes = (items) => assignLanes(items).map((i) => i.lane);

test('a user message and the answer stay in the conversation', () => {
  assert.deepStrictEqual(lanes([user('fais X'), tool(), reply('fait')]), ['conversation', 'conversation', 'conversation']);
});

test('a [cockpit] wake and the master answer go to agents', () => {
  const items = [user('fais X'), reply('ok'), user("[cockpit] L'agent w3 « a » a fini son tour."), tool(), reply('reçu')];
  assert.deepStrictEqual(lanes(items), ['conversation', 'conversation', 'agents', 'agents', 'agents']);
});

test('merged wakes form one agents turn', () => {
  const merged = "[cockpit] L'agent w1 a fini son tour.\n\n[cockpit] L'agent w2 a fini son tour.";
  assert.deepStrictEqual(lanes([reply('ok'), user(merged), reply('reçu')]), ['conversation', 'agents', 'agents']);
});

test('a settings change notice goes to agents', () => {
  assert.deepStrictEqual(lanes([reply('ok'), user("[cockpit] L'utilisateur a changé tes réglages."), reply('noté')]), ['conversation', 'agents', 'agents']);
});

test('a milestone in an agents turn moves to the conversation without its marker', () => {
  const out = assignLanes([reply('ok'), user('[cockpit] w3 a fini.'), reply('reçu'), reply('@Lucas : phase 1 terminée.')]);
  assert.deepStrictEqual(out.map((i) => i.lane), ['conversation', 'agents', 'agents', 'conversation']);
  assert.strictEqual(out[3].text, 'phase 1 terminée.');
  assert.strictEqual(out[3].milestone, true);
});

test('the milestone marker is only read at the start of the message', () => {
  assert.strictEqual(milestoneBody('Je préviens @Lucas demain'), null);
  assert.strictEqual(milestoneBody('@lucas décision à prendre'), 'décision à prendre');
  assert.strictEqual(milestoneBody('@Lucasfoo'), null);
});

test('a user message typed while the master works on a wake takes over the turn', () => {
  const items = [user('[cockpit] w3 a fini.'), tool(), user('plutôt fais Y'), reply('ok je fais Y')];
  assert.deepStrictEqual(lanes(items), ['agents', 'agents', 'conversation', 'conversation']);
});

test('a wake that arrives during a conversation turn does not take it over', () => {
  const items = [user('fais X'), tool(), user('[cockpit] w3 a fini.'), reply('X est fait')];
  assert.deepStrictEqual(lanes(items), ['conversation', 'conversation', 'conversation', 'conversation']);
});

test('detects cockpit messages', () => {
  assert.strictEqual(isCockpitMessage('  [cockpit] x'), true);
  assert.strictEqual(isCockpitMessage('salut [cockpit]'), false);
});
