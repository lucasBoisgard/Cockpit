const test = require('node:test');
const assert = require('node:assert');
const mcp = require('../server/core/mcp');

const LIST = `Checking MCP server health…

claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected
claude.ai Granola: https://mcp.granola.ai/mcp - ! Needs authentication
knip: npx -y @knip/mcp - ✔ Connected
broken: node srv.js - ✗ Failed to connect
team: npx team-mcp - ⏸ Pending approval`;

test('parseClaudeList reads the name, target and health of each line', () => {
  const list = mcp.parseClaudeList(LIST);
  assert.deepStrictEqual(list.map((s) => [s.name, s.target, s.health]), [
    ['claude.ai Slack', 'https://mcp.slack.com/mcp', 'ok'],
    ['claude.ai Granola', 'https://mcp.granola.ai/mcp', 'auth'],
    ['knip', 'npx -y @knip/mcp', 'ok'],
    ['broken', 'node srv.js', 'failed'],
    ['team', 'npx team-mcp', 'pending'],
  ]);
  assert.strictEqual(list[1].healthText, 'Needs authentication');
});

test('claudeServers merges config scopes with the CLI health and keeps secrets out', () => {
  const servers = mcp.claudeServers({
    project: { knip: { command: 'npx', args: ['-y', '@knip/mcp'] } },
    user: { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: 'Bearer secret' } } },
    local: { db: { command: 'db-mcp', env: { DB_PASSWORD: 'secret' } } },
    list: mcp.parseClaudeList(LIST),
  });
  const by = Object.fromEntries(servers.map((s) => [s.name, s]));
  assert.deepStrictEqual([by.knip.source, by.knip.health, by.knip.target, by.knip.removable], ['project', 'ok', 'npx -y @knip/mcp', true]);
  assert.deepStrictEqual([by.sentry.scope, by.sentry.transport, by.sentry.headerKeys, by.sentry.health], ['user', 'http', ['Authorization'], 'unknown']);
  assert.deepStrictEqual(by.db.envKeys, ['DB_PASSWORD']);
  assert.ok(!JSON.stringify(servers).includes('secret'));
  assert.deepStrictEqual([by['claude.ai Slack'].source, by['claude.ai Slack'].removable], ['claude.ai', false]);
  assert.strictEqual(by.broken.source, 'plugin');
  assert.strictEqual(mcp.claudeServers({ user: { a: { command: 'x' } } })[0].health, 'checking');
});

test('codexServers reads codex mcp list --json', () => {
  const servers = mcp.codexServers(JSON.stringify([
    { name: 'docs', enabled: true, transport: { type: 'streamable_http', url: 'https://x/mcp' } },
    { name: 'fs', enabled: false, transport: { type: 'stdio', command: 'fs-mcp', args: ['/tmp'], env: { TOKEN: 'secret' } } },
  ]));
  assert.deepStrictEqual(servers.map((s) => [s.name, s.transport, s.target, s.health]), [['docs', 'http', 'https://x/mcp', 'unknown'], ['fs', 'stdio', 'fs-mcp /tmp', 'disabled']]);
  assert.ok(!JSON.stringify(servers).includes('secret'));
  assert.deepStrictEqual(mcp.codexServers('not json'), []);
});

test('validateAdd normalizes a server and refuses what a provider cannot take', () => {
  const ok = mcp.validateAdd({ provider: 'both', name: 'fs', transport: 'stdio', command: 'npx -y "@mcp/fs server" /tmp', env: 'ROOT=/tmp\n' });
  assert.deepStrictEqual([ok.providers, ok.command, ok.env], [['claude', 'codex'], ['npx', '-y', '@mcp/fs server', '/tmp'], ['ROOT=/tmp']]);
  assert.ok(mcp.validateAdd({ name: 'bad name!', command: 'x' }).error);
  assert.ok(mcp.validateAdd({ name: 'x', transport: 'http', url: 'ftp://x' }).error);
  assert.ok(mcp.validateAdd({ name: 'x', provider: 'codex', transport: 'sse', url: 'https://x' }).error);
  assert.ok(mcp.validateAdd({ name: 'x', transport: 'stdio', command: 'x', headers: 'A: b' }).error);
  assert.ok(mcp.validateAdd({ name: 'x', command: 'x', env: 'pas une variable' }).error);
  assert.ok(mcp.validateAdd({ name: 'x', command: 'x', scope: 'global' }).error);
});

test('add and remove arguments put the name before the variadic options', () => {
  const stdio = mcp.validateAdd({ name: 'fs', command: 'fs-mcp /tmp', env: 'A=1', scope: 'user' });
  assert.deepStrictEqual(mcp.claudeAddArgs(stdio), ['mcp', 'add', 'fs', '-s', 'user', '-t', 'stdio', '-e', 'A=1', '--', 'fs-mcp', '/tmp']);
  assert.deepStrictEqual(mcp.codexAddArgs(stdio), ['mcp', 'add', 'fs', '--env', 'A=1', '--', 'fs-mcp', '/tmp']);
  const http = mcp.validateAdd({ name: 'docs', transport: 'http', url: 'https://x/mcp', headers: 'X-Key: k' });
  assert.deepStrictEqual(mcp.claudeAddArgs(http), ['mcp', 'add', 'docs', 'https://x/mcp', '-s', 'local', '-t', 'http', '-H', 'X-Key: k']);
  assert.deepStrictEqual(mcp.removeArgs('claude', 'knip', 'project'), ['mcp', 'remove', 'knip', '-s', 'project']);
  assert.deepStrictEqual(mcp.removeArgs('codex', 'docs'), ['mcp', 'remove', 'docs']);
  assert.strictEqual(mcp.removeArgs('claude', 'claude.ai Slack', null), null);
});

test('repository servers are kept apart, and shared servers are marked for both providers', () => {
  const rows = mcp.repoServers('acme', { project: { knip: { command: 'npx', args: ['-y', '@knip/mcp'] } }, local: { db: { command: 'db' } } });
  assert.deepStrictEqual(rows.map((r) => [r.name, r.source, r.scope, r.repo, r.removable]), [['knip', 'repo', 'project', 'acme', false], ['db', 'repo', 'local', 'acme', true]]);
  const marked = mcp.markShared([
    { provider: 'claude', source: 'user', name: 'docs' },
    { provider: 'codex', source: 'codex', name: 'docs' },
    { provider: 'claude', source: 'user', name: 'only-claude' },
    { provider: 'claude', source: 'repo', name: 'fs' },
    { provider: 'codex', source: 'codex', name: 'fs' },
  ]);
  assert.deepStrictEqual(marked.map((s) => [s.name, s.provider, s.inClaude, s.inCodex]), [['docs', 'claude', true, true], ['docs', 'codex', true, true], ['only-claude', 'claude', true, false], ['fs', 'claude', false, true], ['fs', 'codex', false, true]]);
});

test('a Claude config converts to add-json and to codex mcp add, or says why Codex cannot take it', () => {
  assert.deepStrictEqual(mcp.claudeJson({ command: 'npx', args: ['x'], env: { A: '1' } }), { type: 'stdio', command: 'npx', args: ['x'], env: { A: '1' } });
  assert.deepStrictEqual(mcp.codexArgsFromConfig('fs', { command: 'npx', args: ['x'], env: { A: '1' } }).args, ['mcp', 'add', 'fs', '--env', 'A=1', '--', 'npx', 'x']);
  assert.deepStrictEqual(mcp.codexArgsFromConfig('docs', { type: 'http', url: 'https://x/mcp' }).args, ['mcp', 'add', 'docs', '--url', 'https://x/mcp']);
  assert.match(mcp.codexArgsFromConfig('s', { type: 'sse', url: 'https://x' }).error, /SSE/);
  assert.match(mcp.codexArgsFromConfig('h', { type: 'http', url: 'https://x', headers: { Authorization: 'Bearer k' } }).error, /en-têtes/);
  assert.ok(mcp.codexArgsFromConfig('bad name', { command: 'x' }).error);
});

test('Claude connectors use their listed URL and a Codex-compatible name', () => {
  const list = mcp.parseClaudeList(LIST);
  assert.deepStrictEqual(mcp.connectorForCodex('claude.ai Slack', list), { name: 'Slack', args: ['mcp', 'add', 'Slack', '--url', 'https://mcp.slack.com/mcp'] });
  assert.ok(mcp.connectorForCodex('claude.ai missing', list).error);
  assert.ok(mcp.connectorForCodex('knip', list).error);
  assert.strictEqual(mcp.markShared([{ name: 'claude.ai Slack', source: 'claude.ai', provider: 'claude' }, { name: 'Slack', source: 'codex', provider: 'codex' }])[0].inCodex, true);
});
