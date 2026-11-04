const test = require('node:test');
const assert = require('node:assert');
const { assignWorktreeNames, repoCandidates } = require('../server/core/git');
const { tmuxSessionName } = require('../server/core/sessions');

const COCKPIT = '/home/u/.claude/worktree-dashboard';

test('names: primary repo keeps plain names, other repos get a stable qualified name', () => {
  const names = assignWorktreeNames([
    { path: `${COCKPIT}-worktrees/fix`, repo: COCKPIT },
    { path: COCKPIT, repo: COCKPIT },
    { path: '/repo', repo: '/repo' },
    { path: '/repo/.claude/worktrees/fix', repo: '/repo' },
  ], '/repo');
  assert.strictEqual(names.get('/repo'), 'main');
  assert.strictEqual(names.get('/repo/.claude/worktrees/fix'), 'fix');
  assert.strictEqual(names.get(COCKPIT), 'worktree-dashboard.main');
  assert.strictEqual(names.get(`${COCKPIT}-worktrees/fix`), 'worktree-dashboard.fix');
});

test('names of other repos do not change when a primary worktree with the same folder name appears', () => {
  const cockpitFix = { path: `${COCKPIT}-worktrees/fix`, repo: COCKPIT };
  const before = assignWorktreeNames([cockpitFix, { path: '/repo', repo: '/repo' }], '/repo');
  const after = assignWorktreeNames([cockpitFix, { path: '/repo', repo: '/repo' }, { path: '/repo/.claude/worktrees/fix', repo: '/repo' }], '/repo');
  assert.strictEqual(before.get(cockpitFix.path), after.get(cockpitFix.path));
  assert.strictEqual(after.get('/repo/.claude/worktrees/fix'), 'fix');
});

test('names stay unique when two repos share a folder name', () => {
  const names = assignWorktreeNames([
    { path: '/a/tools', repo: '/a/tools' },
    { path: '/b/tools', repo: '/b/tools' },
    { path: '/repo', repo: '/repo' },
  ], '/repo');
  assert.strictEqual(names.get('/a/tools'), 'tools.main');
  assert.strictEqual(names.get('/b/tools'), 'tools.main-2');
});

test('tmux session names never contain dots or colons', () => {
  assert.match(tmuxSessionName('worktree-dashboard.fix', 1_700_000_000_000), /^cw-worktree-dashboard_fix-[0-9a-z]{4}$/);
});

test('candidate repos: primary, own, configured and recently used, without duplicates', () => {
  const now = 1_000_000;
  const dirs = repoCandidates({
    primary: '/repo',
    own: '/cockpit',
    extra: ['/other', '/repo'],
    sessions: [{ cwd: '/recent', updatedAt: now - 10 }, { cwd: '/old', updatedAt: now - 5000 }, { cwd: null, updatedAt: now }],
    now,
    recentMs: 1000,
  });
  assert.deepStrictEqual(dirs, ['/repo', '/cockpit', '/other', '/recent']);
});
