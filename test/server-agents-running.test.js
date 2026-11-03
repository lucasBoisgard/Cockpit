const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-running-'));
process.env.HOME = home;
const project = path.join(home, '.claude', 'projects', '-repo');
const transcript = path.join(project, 'sess.jsonl');
const subagents = path.join(project, 'sess', 'subagents');
fs.mkdirSync(subagents, { recursive: true });
fs.writeFileSync(transcript, '');
const { agentsRunning } = require('../server/features/agents');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const writeAgent = (id, meta, lines = []) => {
  fs.writeFileSync(path.join(subagents, `agent-${id}.meta.json`), JSON.stringify(meta));
  fs.writeFileSync(path.join(subagents, `agent-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
};
const session = (status, extra = {}) => ({ sessionId: 'sess', cwd: '/repo', transcriptPath: transcript, status, live: true, updatedAt: Date.now() + 100000, ...extra });

test('a finished turn still counts its running background agents', () => {
  writeAgent('bg', { requestShape: 'background', description: 'bg' }, [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }]);
  writeAgent('done', { requestShape: 'background', finished: true });
  writeAgent('fg', { requestShape: 'foreground' });
  assert.strictEqual(agentsRunning(session('done')), 1);
  assert.strictEqual(agentsRunning(session('idle')), 1);
  assert.strictEqual(agentsRunning(session('working')), 0);
  assert.strictEqual(agentsRunning(session('ended')), 0);
});

test('only live sessions count agents, so a crashed pane no longer holds a card working', () => {
  assert.strictEqual(agentsRunning(session('done', { live: false })), 0);
});

test('a just-finished background agent still counts until the main agent reacts to it', () => {
  writeAgent('late', { requestShape: 'background', finished: true });
  const mtime = fs.statSync(path.join(subagents, 'agent-late.jsonl')).mtimeMs;
  assert.strictEqual(agentsRunning(session('done', { updatedAt: mtime - 5000 }), mtime + 10000), 3);
  assert.strictEqual(agentsRunning(session('done', { updatedAt: mtime + 1 }), mtime + 10000), 1);
  assert.strictEqual(agentsRunning(session('done', { updatedAt: mtime - 5000 }), mtime + 60000), 1);
});

test('no subagents folder or no transcript means no agents', () => {
  assert.strictEqual(agentsRunning({ sessionId: 'x', cwd: '/repo', transcriptPath: path.join(project, 'none.jsonl'), status: 'done', live: true }), 0);
  fs.rmSync(path.join(project, 'sess'), { recursive: true, force: true });
  assert.strictEqual(agentsRunning(session('done')), 0);
});
