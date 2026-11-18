const test = require('node:test');
const assert = require('node:assert');
const { providerBalance, providerUsage, choosableAgents, balanceText } = require('../server/core/provider-balance');

const NOW = 1_800_000_000_000;
const DAY = 86400000;
const launches = (claude, codex, age = DAY) => [
  ...Array.from({ length: claude }, (_, i) => ({ provider: 'claude', createdAt: NOW - age - i })),
  ...Array.from({ length: codex }, (_, i) => ({ provider: 'codex', createdAt: NOW - age - i })),
];
const win = (key, percent, extra = {}) => ({ at: NOW, [key]: { used_percentage: percent, resets_at: Math.floor(NOW / 1000) + 3600, ...extra } });
const limitsOf = (claude, codex) => ({ claude, codex });
const both = { claude: true, codex: true };

const week = (percent) => win('seven_day', percent);
const run = (c, g, extra = {}) => providerBalance({ launches: launches(5, 5), limits: limitsOf(week(c), week(g)), available: both, now: NOW, ...extra });

test('the provider whose weekly window is the less full gets the agent, whatever the agent counts', () => {
  const b = run(5, 11, { launches: launches(90, 10) });
  assert.strictEqual(b.prefer, 'claude');
  assert.match(b.reason, /Claude est le moins plein \(7 j : Claude 5 %, GPT 11 %\)/);
  assert.strictEqual(run(40, 10).prefer, 'codex');
});

test('the less full provider is not pushed when its quota burns faster per unit of work', () => {
  const b = run(5, 11, { work: { claude: 1000, codex: 100 } });
  assert.strictEqual(b.prefer, 'claude');
  const fast = run(5, 11, { work: { claude: 100, codex: 1000 } });
  assert.strictEqual(fast.prefer, 'codex');
  assert.match(fast.reason, /Claude est moins plein .* se vide plus vite par tâche : GPT privilégié/);
});

test('a similar fill with one provider burning faster pushes the other', () => {
  const b = run(20, 21, { work: { claude: 1000, codex: 100 } });
  assert.strictEqual(b.prefer, 'claude');
  assert.match(b.reason, /GPT se vide plus vite/);
});

test('agent counts stand in for tokens when tokens are unknown', () => {
  assert.strictEqual(providerBalance({ launches: launches(2, 20), limits: limitsOf(week(5), week(11)), available: both, now: NOW }).claude.burn, 5 / 2);
  assert.strictEqual(providerBalance({ launches: launches(20, 2), limits: limitsOf(week(5), week(11)), available: both, now: NOW }).prefer, 'claude');
});

test('an unknown window is said and the other signal decides', () => {
  const noWeek = providerBalance({ launches: launches(5, 5), limits: limitsOf(win('five_hour', 70), win('five_hour', 20)), available: both, now: NOW });
  assert.strictEqual(noWeek.prefer, 'codex');
  assert.match(noWeek.reason, /fenêtre courte/);
  assert.match(noWeek.reason, /Fenêtre 7 jours inconnue/);
  const none = providerBalance({ launches: launches(5, 5), available: both, now: NOW });
  assert.match(none.reason, /inconnues : alterne/);
  assert.match(balanceText(none), /Claude 7 j inconnu, 5 h inconnu/);
});

test('both providers full at once: the one with more weekly margin gets the agent', () => {
  const full = (five, seven) => ({ at: NOW, ...win('five_hour', five), seven_day: { used_percentage: seven, resets_at: Math.floor(NOW / 1000) + 3600 } });
  const b = providerBalance({ launches: launches(5, 5), limits: limitsOf(full(92, 95), full(93, 91)), available: both, now: NOW });
  assert.strictEqual(b.prefer, 'codex');
});

test('a window unknown for one provider only is treated as unknown', () => {
  const b = providerBalance({ launches: launches(5, 5), limits: limitsOf({ at: NOW, ...win('five_hour', 70), ...week(10) }, win('five_hour', 20)), available: both, now: NOW });
  assert.strictEqual(b.prefer, 'codex');
  assert.match(b.reason, /Fenêtre 7 jours inconnue/);
});

test('without tokens for one provider the agent counts give the burn rate', () => {
  const b = run(5, 11, { launches: launches(20, 2), work: { claude: 1000, codex: 0 } });
  assert.deepStrictEqual([b.claude.burn, b.codex.burn], [5 / 20, 11 / 2]);
  assert.strictEqual(b.prefer, 'claude');
});

test('no burn signal and equal fills fall back to alternating', () => {
  const b = run(20, 21, { launches: [] });
  assert.deepStrictEqual([b.claude.burn, b.codex.burn], [null, null]);
  assert.match(b.reason, /alterne/);
});

test('the 5-hour window only breaks a weekly tie', () => {
  const limits = limitsOf({ at: NOW, ...win('five_hour', 80), ...week(30) }, { at: NOW, ...win('five_hour', 20), ...week(30) });
  assert.strictEqual(providerBalance({ launches: [], limits, available: both, now: NOW }).prefer, 'codex');
});

test('only the agents of the last seven days count', () => {
  const b = providerBalance({ launches: [...launches(100, 0, 10 * DAY), ...launches(5, 5)], available: both, now: NOW });
  assert.deepStrictEqual([b.claude.agents, b.codex.agents], [5, 5]);
});

test('a provider close to a limit is avoided, and the window is named', () => {
  const b = providerBalance({ launches: launches(10, 90), limits: limitsOf(week(20), win('five_hour', 95)), available: both, now: NOW });
  assert.strictEqual(b.prefer, 'claude');
  assert.match(b.reason, /GPT à 95 % de sa limite 5 h/);
  assert.strictEqual(run(97, 10).prefer, 'codex');
});

test('a stale reading or missing limits are ignored', () => {
  const stale = { claude: { at: NOW, five_hour: { used_percentage: 99, resets_at: Math.floor(NOW / 1000) - 10 } }, codex: null };
  const usage = providerUsage(stale, NOW);
  assert.deepStrictEqual([usage.claude.worst, usage.codex.worst], [null, null]);
});

test('an unavailable provider is never preferred', () => {
  assert.strictEqual(providerBalance({ launches: launches(90, 10), available: { claude: true, codex: false }, now: NOW }).prefer, 'claude');
  assert.strictEqual(providerBalance({ launches: [], available: { claude: false, codex: true }, now: NOW }).prefer, 'codex');
  assert.strictEqual(providerBalance({ available: { claude: false, codex: false }, now: NOW }).prefer, null);
});

test('agents that launched agents of their own are not a provider choice and are left out of the share', () => {
  const store = {
    m1: { agents: [{ id: 'w1', provider: 'claude', createdAt: 1 }, { id: 'w2', parentId: 'w1', provider: 'codex', createdAt: 2 }, { id: 'w3', createdAt: 3 }] },
    m2: { agents: [{ id: 'w1', provider: 'codex', createdAt: 4 }] },
  };
  assert.deepStrictEqual(choosableAgents(store).map((a) => [a.provider, a.createdAt]), [['codex', 2], ['claude', 3], ['codex', 4]]);
  assert.deepStrictEqual(choosableAgents(null), []);
});

test('the text names both fills and the advice', () => {
  const text = balanceText(run(5, 11));
  assert.match(text, /Claude 7 j 5 %, 5 h inconnu \(5 agents sur 7 j\) · GPT 7 j 11 %/);
  assert.match(text, /Prochain agent : Claude/);
  assert.match(balanceText(providerBalance({ available: { claude: false, codex: false }, now: NOW })), /Aucun fournisseur/);
});
