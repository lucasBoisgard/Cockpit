const test = require('node:test');
const assert = require('node:assert');
const { userText, summarizeToolInput, parseChat, parseHistoryMeta, searchSnippet } = require('../server/core/transcript');
const { usageWorktree, latestLimits, tzOffsetMsOf, dayKeys, newUsageEntry, addUsageLines, newCodexEntry, addCodexLines, codexModelLabel, aggregateUsage } = require('../server/core/usage');
const { parseFrontmatter, uniqueByName } = require('../server/core/commands');

const jsonl = (rows) => `${rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;

test('userText keeps slash commands and real prompts, drops reminders and local command noise', () => {
  assert.strictEqual(userText('<command-name>/review</command-name><command-args>12</command-args>'), '/review 12');
  assert.strictEqual(userText('<command-name>/clear</command-name><command-args></command-args>'), '/clear');
  assert.strictEqual(userText('<system-reminder>x</system-reminder> hello '), 'hello');
  assert.strictEqual(userText('<local-command-stdout>x</local-command-stdout>'), null);
  assert.strictEqual(userText('<system-reminder>x</system-reminder>'), null);
});

test('summarizeToolInput prefers the description, then falls back to the JSON', () => {
  assert.strictEqual(summarizeToolInput({ command: 'ls', description: 'List' }), 'List');
  assert.strictEqual(summarizeToolInput({ file_path: '/a' }), '/a');
  assert.strictEqual(summarizeToolInput({ other: 1 }), '{"other":1}');
});

test('parseChat pairs tool results with their call and skips sidechains and meta entries', () => {
  const text = jsonl([
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'Hi' } },
    { type: 'user', isMeta: true, message: { content: 'meta' } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'side' }] } },
    'not json',
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Sure' }, { type: 'text', text: '  ' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'x'.repeat(3005) }], is_error: true }] } },
    { type: 'user', message: { content: [{ type: 'text', text: 'Next' }] } },
  ]);
  const chat = parseChat(text, 's');
  assert.strictEqual(chat.sessionId, 's');
  assert.strictEqual(chat.total, 4);
  assert.deepStrictEqual(chat.items.map((i) => [i.kind, i.text || i.tool]), [['user', 'Hi'], ['assistant', 'Sure'], ['tool', 'Bash'], ['user', 'Next']]);
  assert.strictEqual(chat.items[0].at, Date.parse('2026-01-01T00:00:00Z'));
  assert.strictEqual(chat.items[2].detail, 'ls');
  assert.strictEqual(chat.items[2].error, true);
  assert.strictEqual(chat.items[2].result, `${'x'.repeat(3000)}\n…`);
});

test('parseChat keeps only the last 400 items', () => {
  const rows = Array.from({ length: 450 }, (_, i) => ({ type: 'user', message: { content: `m${i}` } }));
  const chat = parseChat(jsonl(rows), 's');
  assert.strictEqual(chat.total, 450);
  assert.strictEqual(chat.items.length, 400);
  assert.strictEqual(chat.items[0].text, 'm50');
});

test('parseHistoryMeta collects title, counts, branch and edited files relative to the cwd', () => {
  const text = jsonl([
    { type: 'user', cwd: '/repo/wt', gitBranch: 'feat', timestamp: '2026-01-01T00:00:00Z', message: { content: 'Fix the bug' } },
    { type: 'assistant', timestamp: '2026-01-01T00:01:00Z', message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/wt/src/a.js' } }, { type: 'tool_use', name: 'Edit', input: { file_path: '/elsewhere/b.js' } }, { type: 'tool_use', name: 'Read', input: { file_path: '/repo/wt/c.js' } }] } },
    { type: 'user', isSidechain: true, message: { content: 'side' } },
  ]);
  const meta = parseHistoryMeta(text, { sessionId: 's', file: '/f.jsonl', mtimeMs: 5 });
  assert.deepStrictEqual(meta, {
    sessionId: 's',
    file: '/f.jsonl',
    cwd: '/repo/wt',
    branch: 'feat',
    title: 'Fix the bug',
    messages: 2,
    files: ['src/a.js', '/elsewhere/b.js'],
    startedAt: Date.parse('2026-01-01T00:00:00Z'),
    lastAt: Date.parse('2026-01-01T00:01:00Z'),
  });
  assert.strictEqual(parseHistoryMeta('', { sessionId: 's', file: '/f', mtimeMs: 5 }).lastAt, 5);
});

test('searchSnippet cleans the JSON around the match', () => {
  const text = '{"text":"before \\"quoted\\" match\\nafter"}';
  assert.strictEqual(searchSnippet(text, text.indexOf('match'), 5), 'text : before quoted match after');
  assert.strictEqual(searchSnippet(text, -1, 5), '');
});

test('usageWorktree names claude worktrees, the main checkout and other folders', () => {
  assert.strictEqual(usageWorktree('/repo/.claude/worktrees/feat/src', '/repo'), 'feat');
  assert.strictEqual(usageWorktree('/repo/sub', '/repo'), 'main');
  assert.strictEqual(usageWorktree('/repo', '/repo'), 'main');
  assert.strictEqual(usageWorktree('/other/proj', '/repo'), 'proj');
  assert.strictEqual(usageWorktree(null, '/repo'), '?');
});

test('latestLimits takes the newest snapshot carrying rate limits', () => {
  assert.deepStrictEqual(latestLimits([{ at: 1, rateLimits: { a: 1 } }, { at: 3 }, { at: 2, rateLimits: { a: 2 } }]), { a: 2, at: 2 });
  assert.strictEqual(latestLimits([{ at: 1 }]), null);
});

test('tzOffsetMsOf clamps to ±14h and ignores garbage', () => {
  assert.strictEqual(tzOffsetMsOf(-60), -3600000);
  assert.strictEqual(tzOffsetMsOf(2000), 840 * 60000);
  assert.strictEqual(tzOffsetMsOf(NaN), 0);
});

test('dayKeys lists local days ending today', () => {
  const now = Date.UTC(2026, 10, 2, 23, 30);
  assert.deepStrictEqual(dayKeys(now, 0, 3), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepStrictEqual(dayKeys(now, -60 * 60000, 2), ['2026-11-02', '2026-11-03']);
});

test('addUsageLines sums tokens per local day, once per message id', () => {
  const row = (id, timestamp, usage) => ({ type: 'assistant', cwd: '/repo', timestamp, message: { id, usage } });
  const entry = addUsageLines(newUsageEntry(-60 * 60000), jsonl([
    row('m1', '2026-11-01T23:30:00Z', { input_tokens: 1, output_tokens: 2 }),
    row('m1', '2026-11-01T23:30:00Z', { input_tokens: 1, output_tokens: 2 }),
    row('m2', '2026-11-01T10:00:00Z', { cache_read_input_tokens: 5, cache_creation_input_tokens: 3 }),
    { type: 'user', message: { content: 'no usage' } },
  ]).trimEnd());
  assert.strictEqual(entry.cwd, '/repo');
  assert.deepStrictEqual(Object.fromEntries(entry.days), {
    '2026-11-02': { input: 1, cacheWrite: 0, cacheRead: 0, output: 2 },
    '2026-11-01': { input: 0, cacheWrite: 3, cacheRead: 5, output: 0 },
  });
});

test('aggregateUsage splits days and worktrees by provider and ranks worktrees by weekly use', () => {
  const totals = (n) => ({ input: n, cacheWrite: 0, cacheRead: 0, output: 0 });
  const zero = totals(0);
  const entries = [
    { cwd: '/repo', days: new Map([['2026-11-01', totals(1)], ['2026-11-02', totals(2)], ['2026-10-01', totals(100)]]) },
    { cwd: '/repo/.claude/worktrees/x', days: new Map([['2026-11-01', totals(10)]]) },
    { cwd: '/repo/.claude/worktrees/x', provider: 'codex', days: new Map([['2026-11-02', totals(4)]]) },
  ];
  const { days, worktrees } = aggregateUsage(entries, ['2026-11-01', '2026-11-02'], '/repo');
  assert.deepStrictEqual(days, [{ date: '2026-11-01', claude: totals(11), codex: zero }, { date: '2026-11-02', claude: totals(2), codex: totals(4) }]);
  assert.deepStrictEqual(worktrees, [
    { name: 'x', week: { claude: totals(10), codex: totals(4) }, today: { claude: zero, codex: totals(4) } },
    { name: 'main', week: { claude: totals(3), codex: zero }, today: { claude: totals(2), codex: zero } },
  ]);
});

test('addCodexLines turns cumulative token counts into daily deltas, with model, context and limits', () => {
  const count = (timestamp, input, cached, output, used) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count',
    info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output }, last_token_usage: { input_tokens: used }, model_context_window: 1000 },
    rate_limits: { primary: { used_percent: 12, window_minutes: 300, resets_at: 100 }, secondary: { used_percent: 3, window_minutes: 10080, resets_at: 200 } } } });
  const entry = addCodexLines(newCodexEntry(0), jsonl([
    { timestamp: '2026-11-01T10:00:00Z', type: 'session_meta', payload: { id: 's1', cwd: '/repo' } },
    { timestamp: '2026-11-01T10:00:01Z', type: 'turn_context', payload: { model: 'gpt-6-astra' } },
    count('2026-11-01T10:00:02Z', 100, 60, 10, 100),
    count('2026-11-01T10:00:03Z', 100, 60, 10, 100),
    count('2026-11-02T09:00:00Z', 300, 200, 15, 250),
  ]).trimEnd());
  assert.strictEqual(entry.sessionId, 's1');
  assert.strictEqual(entry.cwd, '/repo');
  assert.strictEqual(codexModelLabel(entry.model), 'GPT-6 Astra');
  assert.deepStrictEqual(entry.context, { size: 1000, usedPercentage: 25 });
  assert.deepStrictEqual(Object.fromEntries(entry.days), {
    '2026-11-01': { input: 40, cacheWrite: 0, cacheRead: 60, output: 10 },
    '2026-11-02': { input: 60, cacheWrite: 0, cacheRead: 140, output: 5 },
  });
  assert.deepStrictEqual(entry.rateLimits, { five_hour: { used_percentage: 12, resets_at: 100 }, seven_day: { used_percentage: 3, resets_at: 200 }, at: Date.parse('2026-11-02T09:00:00Z') });
});

test('parseFrontmatter reads plain, quoted and folded values', () => {
  const text = '---\nname: "my-skill"\ndescription: >\n  first line\n  second line\nuser-invocable: false\n---\nbody';
  assert.deepStrictEqual(parseFrontmatter(text), { name: 'my-skill', description: 'first line second line', 'user-invocable': 'false' });
  assert.deepStrictEqual(parseFrontmatter('no frontmatter'), {});
});

test('uniqueByName keeps the first entry of each name', () => {
  assert.deepStrictEqual(uniqueByName([{ name: 'a', s: 1 }, { name: 'b' }, { name: 'a', s: 2 }]), [{ name: 'a', s: 1 }, { name: 'b' }]);
});

test('summarizeToolInput shows the questions of AskUserQuestion, not its JSON', () => {
  assert.strictEqual(summarizeToolInput({ questions: [{ question: 'Quel moyen par défaut ?', options: [] }, { question: 'Quels environnements ?' }] }), 'Quel moyen par défaut ? · Quels environnements ?');
});
