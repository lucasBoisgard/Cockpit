const test = require('node:test');
const assert = require('node:assert');
const { parseCodexPrompt, choiceKeys, activeChoiceKeys, permissionChoiceKeys } = require('../server/core/codex-screen');

const FOLDER = `  Folder access
  /home/dev/.claude/cockpit-worktrees/orch-demo
  Note: You’re in a subdirectory of a Git project. Trusting will apply to the repository root:
  /home/dev/.claude/cockpit
  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings can run code automatically, even without a model request. Continue only if you
  trust these files. Your trust decision will be saved.
› 1. Trust and continue
  2. Quit
  enter continue · esc quit
`;

test('active Codex choices require a visible selection and matching label', () => {
  assert.deepStrictEqual(activeChoiceKeys(FOLDER, 2, 'Quit'), [{ key: 'Down' }, { key: 'Enter' }]);
  assert.strictEqual(activeChoiceKeys(FOLDER, 2, 'Different'), null);
  assert.strictEqual(activeChoiceKeys(FOLDER.replace('› 1.', '  1.'), 2, 'Quit'), null);
});

test('permission choices follow visible labels and refuse ambiguity', () => {
  const screen = 'Approve command?\n› 1. Yes, proceed\n  2. Yes, and do not ask again for this session\n  3. No, cancel\n';
  assert.deepStrictEqual(permissionChoiceKeys(screen, 'allow'), [{ key: 'Enter' }]);
  assert.deepStrictEqual(permissionChoiceKeys(screen, 'always'), [{ key: 'Down' }, { key: 'Enter' }]);
  assert.deepStrictEqual(permissionChoiceKeys(screen, 'deny'), [{ key: 'Down' }, { key: 'Down' }, { key: 'Enter' }]);
  assert.strictEqual(permissionChoiceKeys(screen.replace('› 1.', '  1.'), 'allow'), null);
  assert.strictEqual(permissionChoiceKeys(screen.replace('3. No, cancel', '3. Yes, proceed'), 'allow'), null);
  assert.strictEqual(permissionChoiceKeys(screen, 'unknown'), null);
});

test('parseCodexPrompt reads the folder trust screen of Codex', () => {
  const p = parseCodexPrompt(FOLDER);
  assert.strictEqual(p.kind, 'folder');
  assert.strictEqual(p.title, 'Folder access');
  assert.match(p.text, /Trusting will apply to the repository root:\n\/home\/dev\/\.claude\/cockpit/);
  assert.deepStrictEqual(p.options, [{ n: 1, label: 'Trust and continue' }, { n: 2, label: 'Quit' }]);
  assert.strictEqual(p.selected, 1);
});

test('parseCodexPrompt finds other numbered prompts and ignores screens without a choice', () => {
  const hooks = parseCodexPrompt('Review hooks\n2 hooks need review before they run\n  1. Trust all\n› 2. Review one by one\n  3. Skip\n');
  assert.deepStrictEqual([hooks.kind, hooks.selected, hooks.options.length], ['hooks', 2, 3]);
  assert.strictEqual(parseCodexPrompt('› Écris ta demande\n'), null);
  assert.strictEqual(parseCodexPrompt('Résultat :\n  1. un seul point\n'), null);
});

test('choiceKeys moves from the selected option to the chosen one, then confirms', () => {
  const p = parseCodexPrompt(FOLDER);
  assert.deepStrictEqual(choiceKeys(p, 1), [{ key: 'Enter' }]);
  assert.deepStrictEqual(choiceKeys(p, 2), [{ key: 'Down' }, { key: 'Enter' }]);
  assert.deepStrictEqual(choiceKeys({ ...p, selected: 2 }, 1), [{ key: 'Up' }, { key: 'Enter' }]);
  assert.strictEqual(choiceKeys(p, 9), null);
});

test('parseCodexPrompt also reads the update offer Codex shows at start', () => {
  const p = parseCodexPrompt('  Update available · 0.166.0 → 0.167.0\n  Release notes: https://github.com/openai/codex/releases/latest\n› 1. Update now (runs `npm install -g @openai/codex`)\n  2. Skip\n  3. Skip until next version\n  Press enter to continue\n');
  assert.deepStrictEqual([p.kind, p.title, p.options.map((o) => o.label)], ['prompt', 'Update available · 0.166.0 → 0.167.0', ['Update now (runs `npm install -g @openai/codex`)', 'Skip', 'Skip until next version']]);
});
