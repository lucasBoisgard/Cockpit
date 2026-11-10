const test = require('node:test');
const assert = require('node:assert');
const { quickRoute, routePrompt, parseRoute, parallelSettings } = require('../server/core/routing');

test('parallel GPT sessions retain their provider and launch settings', () => {
  assert.deepStrictEqual(parallelSettings({ provider: 'codex', launch: { model: 'gpt-6-sol', effort: 'high', mode: 'default' } }), { provider: 'codex', model: 'gpt-6-sol', effort: 'high', mode: 'default' });
  assert.deepStrictEqual(parallelSettings({ provider: 'codex' }), { provider: 'codex', model: null, effort: null, mode: 'plan' });
  assert.deepStrictEqual(parallelSettings({ provider: 'claude' }), {});
});

test('quickRoute holds a message while Claude waits on a question, sends it when the session is free', () => {
  assert.strictEqual(quickRoute('needs_input', 'Refais tout le module de paiement avec Stripe et ajoute les tests'), 'queue');
  assert.strictEqual(quickRoute('done', 'Refais tout le module de paiement avec Stripe et ajoute les tests'), 'session');
  assert.strictEqual(quickRoute('idle', 'Nouvelle tâche complètement différente sur la documentation de l’API'), 'session');
});

test('quickRoute keeps short messages, follow-ups and commands in a busy session, and asks for the rest', () => {
  assert.strictEqual(quickRoute('working', 'ajoute aussi un test'), 'session');
  assert.strictEqual(quickRoute('working', 'Stop, tu pars dans la mauvaise direction avec ce refactor du panier complet'), 'session');
  assert.strictEqual(quickRoute('working', '/compact garde seulement les décisions importantes de la session en cours'), 'session');
  assert.strictEqual(quickRoute('working', 'Écris la documentation des endpoints de remboursement dans docs/api.md avec des exemples'), null);
});

test('routePrompt carries the task, the recent actions and the message', () => {
  const prompt = routePrompt({ task: 'Ajoute Stripe', lastAssistant: 'Je branche le SDK', actions: [{ tool: 'Edit', detail: 'src/pay.ts' }], message: 'Documente l’API' });
  for (const part of ['Current task: Ajoute Stripe', 'Last message from Claude: Je branche le SDK', '- Edit: src/pay.ts', 'New message: Documente l’API', '"session"|"parallel"']) assert.ok(prompt.includes(part), part);
});

test('parseRoute reads the JSON answer and keeps anything unclear in the session', () => {
  assert.deepStrictEqual(parseRoute('{"route":"parallel","reason":"Tâche sans lien"}'), { route: 'parallel', reason: 'Tâche sans lien' });
  assert.deepStrictEqual(parseRoute('Voici : {"route":"session"}'), { route: 'session', reason: null });
  assert.deepStrictEqual(parseRoute('parallel'), { route: 'session', reason: null });
  assert.deepStrictEqual(parseRoute('{"route":"other"}'), { route: 'session', reason: null });
});
