const test = require('node:test');
const assert = require('node:assert');
const { checkState, summarizePr, prEvents, runIdsOf, checkFailureText, draftOf, prCreateArgs, verifyCreatedPr } = require('../server/core/pr');
const { stripAnsi, shellQuote, parsePm2List, parseBuildPane, appVerdict, startRefusal, launchCommand, survivorsError, appWentKo } = require('../server/core/app');

test('checkState classifies check runs and status contexts', () => {
  assert.strictEqual(checkState({ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }), 'pending');
  assert.strictEqual(checkState({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }), 'failing');
  assert.strictEqual(checkState({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }), 'passing');
  assert.strictEqual(checkState({ __typename: 'StatusContext', state: 'pending' }), 'pending');
  assert.strictEqual(checkState({ state: 'ERROR' }), 'failing');
  assert.strictEqual(checkState({ conclusion: 'SKIPPED' }), 'passing');
  assert.strictEqual(checkState({}), 'passing');
});

test('summarizePr counts checks by state', () => {
  const pr = summarizePr({
    number: 7,
    url: 'u',
    title: 't',
    state: 'OPEN',
    isDraft: true,
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'd' },
      { __typename: 'StatusContext', context: 'ci', state: 'PENDING', targetUrl: 't' },
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  });
  assert.strictEqual(pr.draft, true);
  assert.strictEqual(pr.base, null);
  assert.deepStrictEqual(pr.checks.map((c) => [c.name, c.state, c.url]), [['lint', 'failing', 'd'], ['ci', 'pending', 't'], ['?', 'passing', null]]);
  assert.deepStrictEqual([pr.failing, pr.pending, pr.passing], [1, 1, 1]);
});

test('prEvents reports a CI turning red and a merge, never on first sight', () => {
  assert.deepStrictEqual(prEvents(null, { number: 1, failing: 2, state: 'MERGED' }), []);
  assert.deepStrictEqual(prEvents({ failing: 0, state: 'OPEN' }, { number: 1, failing: 1, state: 'OPEN' }).map((e) => e.type), ['ci_failed']);
  assert.deepStrictEqual(prEvents({ failing: 1, state: 'OPEN' }, { number: 1, failing: 2, state: 'MERGED' }).map((e) => e.type), ['merged']);
  assert.deepStrictEqual(prEvents({ failing: 0, state: 'OPEN' }, null), []);
});

test('runIdsOf extracts run and job ids from an Actions url', () => {
  assert.deepStrictEqual(runIdsOf('https://github.com/a/b/actions/runs/12/job/34'), { run: '12', job: '34' });
  assert.deepStrictEqual(runIdsOf('https://github.com/a/b/actions/runs/12'), { run: '12', job: null });
  assert.strictEqual(runIdsOf(null), null);
});

test('checkFailureText includes the url and log only when present', () => {
  assert.strictEqual(checkFailureText({ name: 'lint' }, 3, ''), 'Le check « lint » échoue sur la PR #3.\n\nAnalyse la cause et corrige-la.');
  assert.match(checkFailureText({ name: 'lint', url: 'u' }, 3, 'boom'), /PR #3 \(u\)\.\n\nFin du log en échec :\n```\nboom\n```/);
});

test('draftOf titles from the commits and fills the ticket', () => {
  assert.deepStrictEqual(draftOf('feat/skl-12-x', ['only'], '{ticket}!'), { title: 'only', body: 'SKL-12!' });
  assert.strictEqual(draftOf('feat/x', ['newest', 'oldest'], null).title, 'oldest');
  assert.strictEqual(draftOf('feat/x', [], null).title, 'feat/x');
  assert.match(draftOf('feat/x', [], null).body, /^## TL;DR\n\n\n## Ticket\n\n\n\n## Points/);
});

test('prCreateArgs and verifyCreatedPr', () => {
  assert.deepStrictEqual(prCreateArgs({ title: ' T ', body: null, base: 'master', head: 'feat', draft: true, labels: ['A'], assignee: 'me' }), ['pr', 'create', '--title', 'T', '--body', '', '--base', 'master', '--head', 'feat', '--draft', '--label', 'A', '--assignee', 'me']);
  const created = { url: 'u', number: 1, labels: [{ name: 'A' }], assignees: [{ login: 'me' }], body: '🤖 Generated with [Claude Code](x)' };
  assert.deepStrictEqual(verifyCreatedPr(created, ['A'], 'me'), { url: 'u', number: 1, labels: true, assignee: true, footer: false });
  assert.deepStrictEqual(verifyCreatedPr({ ...created, body: '' }, ['B'], ''), { url: 'u', number: 1, labels: false, assignee: true, footer: true });
});

test('stripAnsi and shellQuote', () => {
  assert.strictEqual(stripAnsi('\x1b[31mred\x1b[0m \x1b]0;title\x07ok'), 'red ok');
  assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
});

test('parsePm2List skips the banner, version entries and flags crash loops', () => {
  const now = 100000;
  const list = [
    { name: 'version:1', pm2_env: {} },
    { name: 'api', pm2_env: { status: 'online', restart_time: 5, pm_uptime: now - 1000 } },
    { name: 'job', pm2_env: { status: 'stopped', exit_code: 0 } },
    { name: 'web', pm2_env: { status: 'online', restart_time: 5, pm_uptime: now - 60000 } },
  ];
  assert.deepStrictEqual(parsePm2List(`warning\n${JSON.stringify(list)}`, now), [
    { name: 'api', status: 'online', restarts: 5, exitCode: null, looping: true, finished: false },
    { name: 'job', status: 'stopped', restarts: 0, exitCode: 0, looping: false, finished: true },
    { name: 'web', status: 'online', restarts: 5, exitCode: null, looping: false, finished: false },
  ]);
  assert.strictEqual(parsePm2List('nothing', now), null);
});

test('parseBuildPane reads the dead flag and the last meaningful line', () => {
  assert.deepStrictEqual(parseBuildPane('1\t2\t100\n', 'building\n\x1b[1mfailed\x1b[0m\nPane is dead (status 2)\n'), { running: false, exitCode: 2, startedAt: 100000, lastLine: 'failed' });
  assert.deepStrictEqual(parseBuildPane('0\t\t100', ''), { running: true, exitCode: null, startedAt: 100000, lastLine: '' });
});

test('appVerdict maps build, processes and health to a state', () => {
  const base = { link: null };
  const online = { name: 'api', status: 'online', restarts: 0, exitCode: null, looping: false, finished: false };
  const verdict = (input) => appVerdict(base, { build: null, processes: [], code: null, healthUrl: 'http://h', ...input });
  assert.strictEqual(verdict({ build: { running: false, exitCode: 1 } }).state, 'ko');
  assert.strictEqual(verdict({ build: { running: true }, code: 0 }).state, 'building');
  assert.strictEqual(verdict({}).state, 'stopped');
  assert.deepStrictEqual(verdict({ processes: [online], code: 200 }), { link: null, state: 'up', warnings: [] });
  assert.deepStrictEqual(verdict({ processes: [online], code: 503 }), { link: null, state: 'starting', reason: 'http://h répond encore 503', warnings: [] });
  assert.strictEqual(verdict({ processes: [online], code: 0 }).reason, 'http://h ne répond pas encore');
  const stopped = { ...online, name: 'job', status: 'errored', exitCode: 1 };
  assert.deepStrictEqual(verdict({ processes: [online, stopped], code: 200 }), { link: null, state: 'degraded', reason: 'Process arrêtés : job (code 1)', warnings: ['Process arrêtés : job (code 1)'] });
  assert.strictEqual(verdict({ processes: [{ ...online, looping: true, restarts: 4 }], code: 0 }).state, 'ko');
  assert.strictEqual(verdict({ processes: [{ ...online, status: 'stopped', finished: true }], code: null }).state, 'up');
});

test('startRefusal, launchCommand, survivorsError and appWentKo', () => {
  assert.match(startRefusal(null, false), /Aucune app/);
  assert.strictEqual(startRefusal({ state: 'building' }, true), 'Un build est déjà en cours.');
  assert.strictEqual(startRefusal({ state: 'up' }, false), "L'app tourne déjà.");
  assert.strictEqual(startRefusal({ state: 'up' }, true), null);
  assert.strictEqual(startRefusal({ state: 'stopped' }, false), null);
  assert.strictEqual(launchCommand({ command: 'yarn dev', pending: null }), 'yarn dev');
  assert.strictEqual(launchCommand({ command: 'yarn dev', migrationsCommand: 'migrate', pending: 'a,b', storeFile: '/s.json' }), `yarn dev && migrate && printf '{"fingerprint":"%s","at":%s}' 'a,b' "$(date +%s000)" > '/s.json'`);
  assert.strictEqual(survivorsError([{ pid: 1, ports: [80, 81], cmd: 'vite' }, { pid: 2, ports: [], cmd: 'nx' }]), "Process de l'app toujours vivants après SIGKILL : 1 (port 80, 81) vite · 2 nx");
  assert.ok(appWentKo('up', 'ko'));
  assert.ok(!appWentKo(null, 'ko'));
  assert.ok(!appWentKo('ko', 'ko'));
  assert.ok(!appWentKo('ko', 'up'));
});
