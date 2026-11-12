const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const r = require('../hooks/worktree-rules');

const config = {
  repo: '/srv/app',
  worktrees: {
    include: ['**/.env', '', '**/.env.*'],
    setup: [{ missing: 'node_modules', hint: 'run `npm install`.' }, { missing: 'x' }],
    rules: ['The database is shared.'],
    forbidden: [{ pattern: '\\bnpm\\s+run\\s+dev\\b', label: 'npm run dev' }, { pattern: '([', label: 'broken' }, { pattern: 'DROP\\s+DATABASE', label: 'DROP DATABASE' }],
  },
};

test('worktreeOf finds the worktree of the configured repo only', () => {
  assert.deepStrictEqual(r.worktreeOf('/srv/app/.claude/worktrees/feat-x/src', '/srv/app'), { root: '/srv/app', name: 'feat-x', path: '/srv/app/.claude/worktrees/feat-x' });
  assert.strictEqual(r.worktreeOf('/srv/other/.claude/worktrees/feat-x', '/srv/app'), null);
  assert.strictEqual(r.worktreeOf('/srv/app/src', '/srv/app'), null);
  assert.strictEqual(r.worktreeOf('/srv/other/.claude/worktrees/y', undefined).name, 'y');
});

test('settingsOf keeps the well-formed entries and contextLines lists rules, refusals and missing setup', () => {
  const settings = r.settingsOf(config);
  assert.deepStrictEqual([settings.include.length, settings.setup.length, settings.forbidden.length], [2, 1, 3]);
  assert.deepStrictEqual(r.settingsOf({}), { include: [], setup: [], rules: [], forbidden: [] });
  const lines = r.contextLines({ worktree: r.worktreeOf('/srv/app/.claude/worktrees/w', '/srv/app'), branch: 'worktree-w', settings, exists: () => false });
  assert.match(lines[0], /worktree "w" \(branch worktree-w\)/);
  assert.ok(lines.includes('- The database is shared.'));
  assert.ok(lines.includes('Refused in a worktree: npm run dev, broken, DROP DATABASE.'));
  assert.ok(lines.includes('node_modules is missing: run `npm install`.'));
  assert.ok(!r.contextLines({ worktree: { name: 'w', path: '/w' }, branch: null, settings, exists: () => true }).some((l) => l.includes('missing')));
});

test('forbiddenLabel matches case-insensitively and skips an invalid pattern', () => {
  const settings = r.settingsOf(config);
  assert.strictEqual(r.forbiddenLabel('cd x && NPM run dev', settings), 'npm run dev');
  assert.strictEqual(r.forbiddenLabel('psql -c "drop database app"', settings), 'DROP DATABASE');
  assert.strictEqual(r.forbiddenLabel('npm test', settings), null);
  assert.strictEqual(r.includeText(settings), `${r.INCLUDE_MARKER}\n**/.env\n**/.env.*\n`);
  assert.strictEqual(r.includeText(r.settingsOf({})), '');
});

test('the cockpit only rewrites a .worktreeinclude that is missing or that it wrote', () => {
  assert.strictEqual(r.ownsInclude(null), true);
  assert.strictEqual(r.ownsInclude(''), true);
  assert.strictEqual(r.ownsInclude(`${r.INCLUDE_MARKER}\n**/.env\n`), true);
  assert.strictEqual(r.ownsInclude('**/.env\n.claude/settings.local.json\n'), false);
});

test('loadConfig expands environment variables after parsing, even with quotes in their value', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-cfg-')), 'c.json');
  fs.writeFileSync(file, JSON.stringify({ repo: '${COCKPIT_TEST_DIR}/app', worktrees: { rules: ['x'] } }));
  process.env.COCKPIT_TEST_DIR = '/a "b"';
  assert.strictEqual(r.loadConfig(file).repo, '/a "b"/app');
  assert.deepStrictEqual(r.loadConfig('/nope.json'), {});
});

test('ctx opens the worktree in the configured repo, through a symlink too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-ctx-'));
  const cockpit = path.join(dir, 'cockpit');
  fs.mkdirSync(path.join(cockpit, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(cockpit, 'hooks'));
  fs.copyFileSync(path.join(__dirname, '..', 'bin', 'ctx'), path.join(cockpit, 'bin', 'ctx'));
  fs.copyFileSync(path.join(__dirname, '..', 'hooks', 'worktree-rules.js'), path.join(cockpit, 'hooks', 'worktree-rules.js'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(cockpit, 'cockpit.config.json'), JSON.stringify({ repo }));
  fs.symlinkSync(path.join(cockpit, 'bin', 'ctx'), path.join(dir, 'ctx'));
  const ctx = (...args) => execFileSync('bash', [path.join(dir, 'ctx'), '--dry-run', ...args], { cwd: os.tmpdir(), encoding: 'utf8' }).trim();
  assert.strictEqual(ctx('ABC-12 Fix it'), 'claude --worktree abc-12-fix-it');
  assert.strictEqual(ctx('#42'), "claude --worktree \\#42");
  assert.throws(() => execFileSync('bash', [path.join(dir, 'ctx'), '--dry-run', '!!!'], { stdio: 'pipe' }));
});

test('the hooks inject the context and refuse a forbidden command in a worktree of the configured repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-wt-'));
  const cockpit = path.join(dir, 'cockpit');
  fs.mkdirSync(path.join(cockpit, 'hooks'), { recursive: true });
  for (const f of ['worktree-rules.js', 'worktree-context.js', 'worktree-gate.js']) fs.copyFileSync(path.join(__dirname, '..', 'hooks', f), path.join(cockpit, 'hooks', f));
  const repo = path.join(dir, 'repo');
  const wt = path.join(repo, '.claude', 'worktrees', 'w');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(cockpit, 'cockpit.config.json'), JSON.stringify({ ...config, repo }));
  const hook = (name, input) => execFileSync('node', [path.join(cockpit, 'hooks', name)], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.match(hook('worktree-context.js', { cwd: wt }), /Load and follow the `worktree-session` skill/);
  assert.strictEqual(hook('worktree-context.js', { cwd: repo }), '');
  const denied = JSON.parse(hook('worktree-gate.js', { tool_name: 'Bash', cwd: wt, tool_input: { command: 'npm run dev' } }));
  assert.strictEqual(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(hook('worktree-gate.js', { tool_name: 'Bash', cwd: repo, tool_input: { command: 'npm run dev' } }), '');
  assert.strictEqual(hook('worktree-gate.js', { tool_name: 'Bash', cwd: wt, tool_input: { command: 'npm test' } }), '');
  assert.strictEqual(hook('worktree-gate.js', { tool_name: 'Read', cwd: wt }), '');
});
