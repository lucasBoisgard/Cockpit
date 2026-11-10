const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-skills-'));
process.env.HOME = home;
const { createSkill, listSkills } = require('../server/features/skills');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const content = '---\nname: hello\ndescription: Says hello. Use when asked.\n---\n\n# Hello';

test('createSkill writes a new local skill and never overwrites one', () => {
  const created = createSkill({ target: 'local', name: 'hello', content });
  assert.strictEqual(created.path, path.join(home, '.claude', 'skills', 'hello', 'SKILL.md'));
  assert.strictEqual(fs.readFileSync(created.path, 'utf8'), `${content}\n`);
  assert.match(createSkill({ target: 'local', name: 'hello', content }).error, /existe déjà/);
});

test('createSkill refuses unknown targets, bad names and invalid content', () => {
  assert.match(createSkill({ target: 'elsewhere', name: 'x', content }).error, /Emplacement/);
  assert.match(createSkill({ target: 'local', name: '../escape', content }).error, /Nom invalide/);
  assert.match(createSkill({ target: 'local', name: 'nometa', content: '# no frontmatter' }).error, /en-tête/);
  assert.strictEqual(fs.existsSync(path.join(home, '.claude', 'skills', 'nometa')), false);
});

test('GPT skills are created in the shared agent directory and listed separately', async () => {
  const created = createSkill({ target: 'codexLocal', name: 'hello', content });
  assert.strictEqual(created.path, path.join(home, '.agents', 'skills', 'hello', 'SKILL.md'));
  assert.match(createSkill({ target: 'codexLocal', name: 'hello', content }).error, /existe déjà/);
  const result = await listSkills();
  assert.ok(result.tree.find((group) => group.source === 'codexLocal')?.items.some((item) => item.path === created.path));
});
