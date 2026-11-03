const test = require('node:test');
const assert = require('node:assert');
const { skillTree, validateSkill, draftFrom, bodyOf } = require('../server/core/skills');

test('skillTree groups skills by source, then by folder, local first', () => {
  const tree = skillTree([
    { source: 'repo', kind: 'command', name: 'biscui:migrate-scope', namespace: ['biscui'], path: '/r/.claude/commands/biscui/migrate-scope.md' },
    { source: 'repo', kind: 'skill', name: 'hexa-domain', description: 'Domain', path: '/r/.claude/skills/hexa-domain/SKILL.md' },
    { source: 'plugin', plugin: 'figma', kind: 'skill', name: 'figma:use', path: '/p/SKILL.md' },
    { source: 'local', kind: 'skill', name: 'architecture-audit', path: '/h/SKILL.md' },
    { source: 'repo', kind: 'command', name: 'prep', path: '/r/.claude/commands/prep.md' },
  ]);
  assert.deepStrictEqual(tree.map((g) => g.id), ['local', 'repo', 'plugin:figma']);
  const repo = tree[1];
  assert.deepStrictEqual(repo.items.map((i) => `${i.kind}:${i.name}`), ['command:prep', 'skill:hexa-domain']);
  assert.deepStrictEqual(repo.folders.map((f) => [f.name, f.items.map((i) => i.name)]), [['biscui', ['biscui:migrate-scope']]]);
});

test('validateSkill checks the name, the frontmatter and the body', () => {
  const ok = '---\nname: my-skill\ndescription: Does things. Use when asked.\n---\n\n# My skill\n';
  assert.strictEqual(validateSkill('my-skill', ok).meta.description, 'Does things. Use when asked.');
  assert.match(validateSkill('My Skill', ok).error, /Nom invalide/);
  assert.match(validateSkill('my-skill', '# no frontmatter').error, /en-tête YAML/);
  assert.match(validateSkill('my-skill', '---\nname: my-skill\n---\nbody').error, /description/);
  assert.match(validateSkill('other', ok).error, /ne correspond pas/);
  assert.match(validateSkill('my-skill', '---\ndescription: d\n---\n  \n').error, /pas de contenu/);
  assert.ok(validateSkill('my-skill', '---\ndescription: d\n---\nbody').meta);
});

test('draftFrom takes the last fenced SKILL.md, even with code blocks inside', () => {
  const answer = [
    'Voici une idée :',
    '```js',
    'const a = 1;',
    '```',
    'Et le skill :',
    '````markdown',
    '---',
    'name: x',
    'description: d',
    '---',
    '',
    '```bash',
    'ls',
    '```',
    '````',
  ].join('\n');
  assert.strictEqual(draftFrom(answer), '---\nname: x\ndescription: d\n---\n\n```bash\nls\n```');
  assert.strictEqual(draftFrom('~~~markdown\n---\nname: y\n---\nbody\n~~~'), '---\nname: y\n---\nbody');
  assert.strictEqual(draftFrom('```markdown\n---\nname: y\n---\nbody\n```'), null);
  assert.strictEqual(draftFrom('pas de brouillon'), null);
});

test('bodyOf drops the frontmatter', () => {
  assert.strictEqual(bodyOf('---\nname: x\n---\n# T\n'), '# T\n');
  assert.strictEqual(bodyOf('# T'), '# T');
});
