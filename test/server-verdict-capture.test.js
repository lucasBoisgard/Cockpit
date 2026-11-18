const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-verdict-capture-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.claude', 'worktree-state'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
fs.mkdirSync(path.join(home, '.codex', 'sessions'), { recursive: true });
after(() => fs.rmSync(home, { recursive: true, force: true }));

require('../server/features/worktrees').livePanes = async () => new Map([['%900001', { session: 'x', created: 0 }]]);
const queue = require('../server/features/queue');
const delivered = [];
queue.sendToSession = async () => true;
queue.deliver = async (sessionId, text) => { delivered.push({ sessionId, text }); return 'sent'; };
const orchestration = require('../server/features/orchestration');
const matrix = require('../server/features/matrix');

const ENVELOPE = (target) => `All reviewed.\n<verdict-report v="1">\non ${target}\nF1 blocking: it crashes (a.js:1)\n</verdict-report>`;
const transcripts = {
  claude: (text, uuid) => [{ type: 'user', uuid: 'u', message: { role: 'user', content: 'task' } }, { type: 'assistant', uuid, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } }],
  codex: (text, id) => [{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'task' }] } }, { type: 'response_item', payload: { type: 'message', id, role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text }] } }, { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: text } }],
};

function setup(provider, text, id) {
  const dir = provider === 'codex' ? path.join(home, '.codex', 'sessions') : path.join(home, '.claude', 'projects', 'p');
  const file = path.join(dir, `${provider}.jsonl`);
  fs.writeFileSync(file, `${transcripts[provider](text, id).map((r) => JSON.stringify(r)).join('\n')}\n`);
  const sessionId = `s-${provider}`;
  fs.writeFileSync(path.join(home, '.claude', 'worktree-state', `${sessionId}.json`), JSON.stringify({ sessionId, provider, cwd: '/tmp/x', transcriptPath: file, status: 'idle', updatedAt: Date.now() }));
  const agent = (n, extra) => ({ id: `w${n}`, name: `a${n}`, brief: 'b', provider: 'claude', model: 'sonnet', effort: 'low', skills: [], phase: 0, createdAt: 1, cwd: '/tmp/x', worktree: 'x', ...extra });
  const orch = { masterSessionId: 'm1', worktree: 'x', phases: [], events: [], pendingWake: [], settings: { autonomy: 'high', maxAgents: 5, agentMode: 'auto' }, createdAt: 1, agents: [agent(1, { kind: 'implement', obs: 'a'.repeat(32), deliveries: 1 }), agent(2, { kind: 'review', provider, sessionId, obs: 'b'.repeat(32), missions: [{ role: 'reviewer', targets: ['w1'] }] })] };
  fs.writeFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), JSON.stringify({ m1: orch }));
  delivered.length = 0;
}

for (const provider of ['claude', 'codex']) {
  test(`${provider}: an envelope in the final message becomes records and a wake line, a re-capture adds nothing`, async () => {
    setup(provider, ENVELOPE('w1'), 'msg-1');
    orchestration.onSessionEvent(`s-${provider}`, { type: 'done' }, { lastAssistant: 'x' });
    const before = matrix.readVerdictRecords().filter((r) => r.type === 'finding');
    assert.strictEqual(before.length, 1);
    assert.strictEqual(before[0].target.agent, 'w1');
    assert.strictEqual(before[0].judge.role, 'reviewer');
    assert.strictEqual(orchestration.readStore().m1.agents[1].finalMessage.id, 'msg-1');
    assert.match((queue.loadQueues().m1 || []).map((i) => i.text).join('\n'), /Verdicts : 1 constat sur w1/);
    const again = await orchestration.captureAgent({ caller: 'm1', id: 'w2' });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(matrix.readVerdictRecords().filter((r) => r.type === 'finding').length, 1);
    assert.strictEqual(orchestration.readStore().m1.agents[1].deliveries, 1);
  });

  test(`${provider}: a quoted example earlier in the message yields nothing, a target outside the mission is reported`, async () => {
    setup(provider, `Example:\n\`\`\`\n<verdict-report v="1">\non w1\nclean\n</verdict-report>\n\`\`\`\nNo verdict here.`, 'msg-2');
    const quoted = await orchestration.captureAgent({ caller: 'm1', id: 'w2' });
    assert.deepStrictEqual(quoted.lines, []);
    setup(provider, ENVELOPE('w2'), 'msg-3');
    const outside = await orchestration.captureAgent({ caller: 'm1', id: 'w2' });
    assert.match(outside.lines.join('\n'), /Ligne ignorée/);
  });
}

const writeTranscript = (provider, text, id) => {
  const file = path.join(provider === 'codex' ? path.join(home, '.codex', 'sessions') : path.join(home, '.claude', 'projects', 'p'), `${provider}.jsonl`);
  fs.writeFileSync(file, `${transcripts[provider](text, id).map((r) => JSON.stringify(r)).join('\n')}\n`);
};

test('done: a quoted example followed by the real envelope records the real one only; an envelope that is not last yields nothing', async () => {
  const quoted = '```\n<verdict-report v="1">\non w1\nclean\n</verdict-report>\n```\n';
  setup('claude', `${quoted}${ENVELOPE('w1')}`, 'msg-5');
  orchestration.onSessionEvent('s-claude', { type: 'done' }, { lastAssistant: 'x' });
  const found = matrix.readVerdictRecords().filter((r) => r.judge?.obs === 'b'.repeat(32));
  assert.deepStrictEqual(found.map((r) => r.type), ['finding']);
  setup('claude', `${ENVELOPE('w1')}\nand then some more text`, 'msg-6');
  assert.deepStrictEqual((await orchestration.captureAgent({ caller: 'm1', id: 'w2' })).lines, []);
});

test('--capture reads the transcript before the remembered message, so a newer turn is captured', async () => {
  setup('claude', 'no verdict this turn', 'msg-7');
  assert.deepStrictEqual((await orchestration.captureAgent({ caller: 'm1', id: 'w2' })).lines, []);
  writeTranscript('claude', ENVELOPE('w1').replace('F1', 'F7'), 'msg-8');
  const second = await orchestration.captureAgent({ caller: 'm1', id: 'w2' });
  assert.match(second.lines[0], /Verdicts : 1 constat sur w1/);
});

test('a capture that throws does not remember the message id, so it is retried', async () => {
  const verdicts = require('../server/core/verdicts');
  const original = verdicts.acceptLines;
  setup('claude', ENVELOPE('w1').replace('F1', 'F8'), 'msg-9');
  verdicts.acceptLines = () => { throw new Error('boom'); };
  try {
    orchestration.onSessionEvent('s-claude', { type: 'done' }, { lastAssistant: 'x' });
  } finally {
    verdicts.acceptLines = original;
  }
  assert.strictEqual(orchestration.readStore().m1.agents[1].finalMessage, undefined);
  assert.match((await orchestration.captureAgent({ caller: 'm1', id: 'w2' })).lines[0], /Verdicts/);
});

test('late transcript: the verdicts found by the retry reach the master in a message of their own', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setup('claude', 'previous turn', 'msg-10');
  fs.rmSync(path.join(home, '.claude', 'projects', 'p', 'claude.jsonl'));
  orchestration.onSessionEvent('s-claude', { type: 'done' }, { lastAssistant: 'x' });
  writeTranscript('claude', ENVELOPE('w1').replace('F1', 'F9'), 'msg-11');
  t.mock.timers.tick(6000);
  assert.match((queue.loadQueues().m1 || []).map((i) => i.text).join('\n'), /transcript arrivé après la fin du tour[\s\S]*Verdicts : 1 constat sur w1/);
});

test('an agent with no mission and never judged is not read at all', () => {
  setup('claude', ENVELOPE('w1'), 'msg-12');
  const all = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), 'utf8'));
  all.m1.agents[1].missions = [];
  fs.writeFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), JSON.stringify(all));
  orchestration.onSessionEvent('s-claude', { type: 'done' }, { lastAssistant: 'x' });
  assert.strictEqual(orchestration.readStore().m1.agents[1].finalMessage, undefined);
});

test('a launch with --explore is refused without a category, without a credit', async () => {
  setup('claude', 'x', 'msg-13');
  assert.match((await orchestration.launchAgent({ caller: 'm1', name: 'e', brief: 'b', explore: true })).error, /--kind/);
  assert.match((await orchestration.launchAgent({ caller: 'm1', name: 'e', brief: 'b', kind: 'implement', explore: true })).error, /crédit/);
});

test('verdicts: labels are French', async () => {
  setup('claude', ENVELOPE('w1').replace('F1', 'F10'), 'msg-14');
  await orchestration.captureAgent({ caller: 'm1', id: 'w2' });
  const out = orchestration.verdictsView({ caller: 'm1' }).lines.join('\n');
  assert.match(out, /\[bloquant\]/);
  assert.doesNotMatch(out, /\[blocking\]/);
});

test('a message after the first delivery is a round, send --info is not', async () => {
  setup('claude', 'x', 'msg-4');
  await orchestration.sendToAgent({ caller: 'm1', id: 'w1', text: 'fix this' });
  await orchestration.sendToAgent({ caller: 'm1', id: 'w1', text: 'FYI scope', info: true });
  assert.strictEqual(orchestration.readStore().m1.agents[0].rounds, 1);
});

test('--capture is refused while the agent works, and a message that is not final is not captured', async () => {
  setup('claude', ENVELOPE('w1').replace('F1', 'F11'), 'msg-15');
  const statePath = path.join(home, '.claude', 'worktree-state', 's-claude.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.writeFileSync(statePath, JSON.stringify({ ...state, status: 'working', tmuxPane: '%900001', updatedAt: Date.now() }));
  assert.match((await orchestration.captureAgent({ caller: 'm1', id: 'w2' })).error, /travaille encore/);
  fs.writeFileSync(statePath, JSON.stringify(state));
  const file = path.join(home, '.claude', 'projects', 'p', 'claude.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', uuid: 'mid', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: ENVELOPE('w1').replace('F1', 'F12') }] } })}\n`);
  const pending = await orchestration.captureAgent({ caller: 'm1', id: 'w2' });
  assert.deepStrictEqual([pending.lines, pending.reason], [[], 'pending']);
});

test('replaying a processed message adds nothing, even after the target delivered again', async () => {
  setup('claude', 'All good.\n<verdict-report v="1">\non w1\nclean\n</verdict-report>', 'msg-16');
  assert.deepStrictEqual((await orchestration.captureAgent({ caller: 'm1', id: 'w2' })).lines, ['Verdicts : w1 propre']);
  const all = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), 'utf8'));
  all.m1.agents[0].deliveries = 2;
  fs.writeFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), JSON.stringify(all));
  const again = await orchestration.captureAgent({ caller: 'm1', id: 'w2' });
  assert.deepStrictEqual([again.lines, again.reason], [[], 'known']);
  assert.strictEqual(matrix.readVerdictRecords().filter((r) => r.type === 'clean' && r.judge.agent === 'w2' && r.delivery === 2).length, 0);
});

test('a failing budget measure never stops the delivery count or the wake of the master', () => {
  const usage = require('../server/features/usage');
  const original = usage.sessionTokens;
  usage.sessionTokens = () => { throw new Error('scan failed'); };
  setup('claude', 'x', 'msg-17');
  const all = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), 'utf8'));
  all.m1.settings.agentTokenBudget = 1;
  fs.writeFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), JSON.stringify(all));
  try {
    orchestration.onSessionEvent('s-claude', { type: 'done' }, { lastAssistant: 'x' });
  } finally {
    usage.sessionTokens = original;
  }
  assert.strictEqual(orchestration.readStore().m1.agents[1].deliveries, 1);
  assert.match((queue.loadQueues().m1 || []).map((i) => i.text).join('\n'), /w2/);
});

test('an exploration without a verifier stays flagged after an outcome; the outcome note is redacted', async () => {
  setup('claude', 'x', 'msg-18');
  const all = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), 'utf8'));
  Object.assign(all.m1.agents[0], { explore: true, deliveries: 1 });
  fs.writeFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), JSON.stringify(all));
  const flagged = async () => (await orchestration.orchestrationViews()).active.m1.agents[0].unverifiedExploration;
  assert.strictEqual(await flagged(), true);
  await orchestration.outcomeAgent({ caller: 'm1', id: 'w1', outcome: 'as-is', note: 'see /home/alice/secret and 123e4567-e89b-12d3-a456-426614174000' });
  assert.strictEqual(await flagged(), true);
  const record = matrix.readVerdictRecords().filter((r) => r.type === 'outcome' && r.pick.agent === 'w1').at(-1);
  assert.doesNotMatch(record.note, /123e4567/);
  assert.doesNotMatch(record.note, /alice/);
});
