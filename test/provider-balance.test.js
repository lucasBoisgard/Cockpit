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

test('a master that mostly used Claude is pushed towards GPT, with the reason', () => {
  const b = providerBalance({ launches: launches(90, 10), available: both, now: NOW });
  assert.strictEqual(b.prefer, 'codex');
  assert.deepStrictEqual([b.claude.agents, b.codex.agents, b.codex.share], [90, 10, 0.1]);
  assert.match(b.reason, /GPT 10 % des agents/);
});

test('too much GPT pushes back towards Claude', () => {
  assert.strictEqual(providerBalance({ launches: launches(10, 90), available: both, now: NOW }).prefer, 'claude');
});

test('an even split alternates with the provider of the latest agent', () => {
  const claudeLast = [...launches(5, 5, 3 * DAY), { provider: 'claude', createdAt: NOW - 1000 }, { provider: 'codex', createdAt: NOW - 2 * DAY }];
  const b = providerBalance({ launches: claudeLast, available: both, now: NOW });
  assert.deepStrictEqual([b.last, b.prefer], ['claude', 'codex']);
  assert.match(b.reason, /alterne/);
  const codexLast = [...launches(5, 5, 3 * DAY), { provider: 'codex', createdAt: NOW - 1000 }, { provider: 'claude', createdAt: NOW - 2 * DAY }];
  assert.strictEqual(providerBalance({ launches: codexLast, available: both, now: NOW }).prefer, 'claude');
  assert.strictEqual(providerBalance({ launches: [], available: both, now: NOW }).prefer, 'claude');
});

test('only the agents of the last seven days count', () => {
  const b = providerBalance({ launches: [...launches(100, 0, 10 * DAY), ...launches(5, 5)], available: both, now: NOW });
  assert.deepStrictEqual([b.claude.agents, b.codex.agents], [5, 5]);
});

test('the 7-day headroom decides between even shares, the 5-hour window does not', () => {
  const week = providerBalance({ launches: launches(50, 50), limits: limitsOf(win('seven_day', 80), win('seven_day', 20)), available: both, now: NOW });
  assert.strictEqual(week.prefer, 'codex');
  assert.match(week.reason, /utilisation 7 jours : Claude 80 %, GPT 20 %/);
  const burst = providerBalance({ launches: launches(50, 50), limits: limitsOf(win('five_hour', 80), win('five_hour', 20)), available: both, now: NOW });
  assert.match(burst.reason, /alterne/);
});

test('a provider close to a limit is avoided, and the window is named', () => {
  const b = providerBalance({ launches: launches(10, 90), limits: limitsOf(win('seven_day', 20), win('five_hour', 95)), available: both, now: NOW });
  assert.strictEqual(b.prefer, 'claude');
  assert.match(b.reason, /GPT à 95 % de sa limite 5 h/);
  assert.strictEqual(providerBalance({ launches: launches(90, 10), limits: limitsOf(win('seven_day', 97), win('seven_day', 10)), available: both, now: NOW }).prefer, 'codex');
});

test('when both accounts are almost full the one with more 7-day margin gets the agent', () => {
  const limits = limitsOf({ at: NOW, ...win('five_hour', 92), seven_day: { used_percentage: 95, resets_at: Math.floor(NOW / 1000) + 3600 } }, { at: NOW, ...win('five_hour', 93), seven_day: { used_percentage: 91, resets_at: Math.floor(NOW / 1000) + 3600 } });
  const b = providerBalance({ launches: launches(50, 50), limits, available: both, now: NOW });
  assert.strictEqual(b.prefer, 'codex');
  assert.match(b.reason, /deux comptes sont presque pleins/);
});

test('a stale reading or missing limits are ignored', () => {
  const stale = { claude: { at: NOW, five_hour: { used_percentage: 99, resets_at: Math.floor(NOW / 1000) - 10 } }, codex: null };
  const usage = providerUsage(stale, NOW);
  assert.deepStrictEqual([usage.claude.worst, usage.codex.worst], [null, null]);
  assert.strictEqual(providerBalance({ launches: launches(50, 50), limits: stale, available: both, now: NOW }).claude.usedPercent, null);
});

test('an unavailable provider is never preferred', () => {
  assert.strictEqual(providerBalance({ launches: launches(90, 10), available: { claude: true, codex: false }, now: NOW }).prefer, 'claude');
  assert.strictEqual(providerBalance({ launches: [], available: { claude: false, codex: true }, now: NOW }).prefer, 'codex');
  assert.strictEqual(providerBalance({ available: { claude: false, codex: false }, now: NOW }).prefer, null);
});

test('the target share is configurable', () => {
  assert.strictEqual(providerBalance({ launches: launches(70, 30), available: both, target: 0.3, now: NOW }).reason.includes('alterne'), true);
  assert.strictEqual(providerBalance({ launches: launches(70, 30), available: both, target: 0.5, now: NOW }).prefer, 'codex');
});

test('agents that launched agents of their own are not a provider choice and are left out of the share', () => {
  const store = {
    m1: { agents: [{ id: 'w1', provider: 'claude', createdAt: 1 }, { id: 'w2', parentId: 'w1', provider: 'codex', createdAt: 2 }, { id: 'w3', createdAt: 3 }] },
    m2: { agents: [{ id: 'w1', provider: 'codex', createdAt: 4 }] },
  };
  assert.deepStrictEqual(choosableAgents(store).map((a) => [a.provider, a.createdAt]), [['codex', 2], ['claude', 3], ['codex', 4]]);
  assert.deepStrictEqual(choosableAgents(null), []);
});

test('the text names both shares and the advice', () => {
  const text = balanceText(providerBalance({ launches: launches(90, 10), limits: limitsOf(win('five_hour', 61), win('five_hour', 12)), available: both, now: NOW }));
  assert.match(text, /Claude 90 agents \(90 %\) · limite à 61 %, GPT 10 \(10 %\) · limite à 12 %/);
  assert.match(text, /Prochain agent : GPT/);
  assert.match(balanceText(providerBalance({ available: { claude: false, codex: false }, now: NOW })), /Aucun fournisseur/);
});
