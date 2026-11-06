const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { questionsOf, checkAnswers, hookOutput } = require('../hooks/ask');

const INPUT = {
  questions: [
    { question: 'Quelle base ?', header: 'Base', multiSelect: false, options: [{ label: 'main', description: 'La branche principale' }, { label: 'develop', description: '' }] },
    { question: 'Quelles vérifs ?', header: 'Vérifs', multiSelect: true, options: [{ label: 'Tests', description: '' }, { label: 'Lint', description: '' }] },
  ],
};

test('questionsOf keeps every question with its options and descriptions', () => {
  const qs = questionsOf(INPUT);
  assert.strictEqual(qs.length, 2);
  assert.deepStrictEqual(qs[0], { question: 'Quelle base ?', header: 'Base', multiSelect: false, options: [{ label: 'main', description: 'La branche principale' }, { label: 'develop', description: '' }] });
  assert.strictEqual(qs[1].multiSelect, true);
  assert.deepStrictEqual(questionsOf({}), []);
});

test('checkAnswers needs every question, one choice unless multi-select, and accepts free text', () => {
  assert.deepStrictEqual(checkAnswers(INPUT, { 'Quelle base ?': 'Une autre, hotfix/7.5', 'Quelles vérifs ?': ['Tests', 'Lint'] }).answers, { 'Quelle base ?': 'Une autre, hotfix/7.5', 'Quelles vérifs ?': 'Tests, Lint' });
  assert.match(checkAnswers(INPUT, { 'Quelle base ?': 'main' }).error, /Quelles vérifs/);
  assert.match(checkAnswers(INPUT, { 'Quelle base ?': ['main', 'develop'], 'Quelles vérifs ?': 'Tests' }).error, /Un seul choix/);
  assert.ok(checkAnswers({}, {}).error);
});

test('hookOutput allows the tool with the original questions and the answers', () => {
  const out = hookOutput(INPUT, { 'Quelle base ?': 'main' });
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepStrictEqual(out.hookSpecificOutput.updatedInput.questions, INPUT.questions);
  assert.deepStrictEqual(out.hookSpecificOutput.updatedInput.answers, { 'Quelle base ?': 'main' });
});

function runRelay(home, env, payload) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'hooks', 'ask-relay.js')], { env: { ...process.env, HOME: home, ...env } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stdin.end(JSON.stringify(payload));
  return { child, done: new Promise((resolve) => child.on('exit', () => resolve(out))) };
}

async function waitFor(file) {
  for (let i = 0; i < 50 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const payload = { session_id: 'sess-1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1', tool_input: INPUT };

test('the relay answers Claude with what the cockpit wrote, then cleans up', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-'));
  const dir = path.join(home, '.claude', 'worktree-asks');
  const { done } = runRelay(home, { COCKPIT_ASK: '1' }, payload);
  const pending = await waitFor(path.join(dir, 'sess-1.json'));
  assert.strictEqual(pending.toolUseId, 'tu-1');
  fs.writeFileSync(path.join(dir, 'sess-1.answer.json'), JSON.stringify({ toolUseId: 'tu-1', answers: { 'Quelle base ?': 'main', 'Quelles vérifs ?': ['Lint'] } }));
  const out = JSON.parse(await done);
  assert.deepStrictEqual(out.hookSpecificOutput.updatedInput.answers, { 'Quelle base ?': 'main', 'Quelles vérifs ?': 'Lint' });
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('the relay steps aside for the terminal, and never holds a session not launched by the cockpit', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-'));
  const dir = path.join(home, '.claude', 'worktree-asks');
  const deferred = runRelay(home, { COCKPIT_ASK: '1' }, payload);
  await waitFor(path.join(dir, 'sess-1.json'));
  fs.writeFileSync(path.join(dir, 'sess-1.answer.json'), JSON.stringify({ toolUseId: 'tu-1', defer: true }));
  assert.strictEqual(await deferred.done, '');
  const outside = runRelay(home, { COCKPIT_ASK: '' }, payload);
  assert.strictEqual(await outside.done, '');
  assert.ok(!fs.existsSync(path.join(dir, 'sess-1.json')));
});
