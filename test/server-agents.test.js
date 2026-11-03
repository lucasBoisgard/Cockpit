const test = require('node:test');
const assert = require('node:assert');
const { emptyActivity, applyText, agentActivity, workflowProgress, agentTree, countRunning } = require('../server/core/agents');

const line = (entry) => JSON.stringify(entry);
const ts = (ms) => new Date(ms).toISOString();
const use = (id, name, input, at = 1000) => line({ type: 'assistant', timestamp: ts(at), message: { content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } });
const result = (id) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
const answer = (text) => line({ type: 'assistant', message: { content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
const prompt = (content, at = 500) => line({ type: 'user', timestamp: ts(at), message: { role: 'user', content } });

test('agentActivity reports the last tool and whether it still runs', () => {
  const running = agentActivity(use('t1', 'Bash', { command: 'ls' }, 1000));
  assert.deepStrictEqual([running.action, running.pending, running.ended], [{ tool: 'Bash', detail: 'ls' }, { t1: 1000 }, false]);
  const back = agentActivity([use('t1', 'Read', { file_path: '/a' }), result('t1')].join('\n'));
  assert.deepStrictEqual([back.action, back.pending], [{ tool: 'Read', detail: '/a' }, {}]);
  assert.deepStrictEqual(agentActivity('{broken\n'), emptyActivity());
});

test('agentActivity sees an agent end on a final answer, a handback or a structured output', () => {
  assert.strictEqual(agentActivity([use('t1', 'Read', { file_path: '/a' }), result('t1'), answer('done')].join('\n')).ended, true);
  assert.strictEqual(agentActivity([use('t1', 'SubagentHandback', { message: 'report' }), result('t1')].join('\n')).ended, true);
  assert.strictEqual(agentActivity(use('t1', 'StructuredOutput', { key: 'x' })).ended, true);
  assert.strictEqual(agentActivity([answer('done'), prompt('again')].join('\n')).ended, false);
});

test('skills of the current turn come from Skill calls and slash commands, built-ins excluded', () => {
  const builtins = new Set(['model']);
  const text = [
    prompt('<command-message>prep</command-message>\n<command-name>/prep</command-name>\n<command-args>x</command-args>', 100),
    use('s1', 'Skill', { skill: 'hexa-domain' }, 200),
    result('s1'),
    use('s2', 'Skill', { skill: 'hexa-domain' }, 300),
  ].join('\n');
  assert.deepStrictEqual(agentActivity(text, builtins).skills.map((s) => [s.name, s.at]), [['prep', 100], ['hexa-domain', 300]]);
  assert.strictEqual(agentActivity(text, builtins).prompt, '/prep x');
  assert.deepStrictEqual(agentActivity([text, prompt('<command-name>/model</command-name>', 400)].join('\n'), builtins).skills, []);
  assert.deepStrictEqual(agentActivity([text, line({ type: 'user', isMeta: true, message: { content: 'notification' } })].join('\n'), builtins).skills.length, 2);
  assert.strictEqual(agentActivity([prompt('fix  the\nbug'), line({ type: 'user', isMeta: true, message: { content: '<agent-message>x' } })].join('\n')).prompt, 'fix the bug');
});

test('applyText keeps accumulating across chunks', () => {
  const activity = emptyActivity();
  applyText(activity, use('t1', 'Bash', { command: 'a' }));
  applyText(activity, result('t1'));
  applyText(activity, use('s1', 'Skill', { skill: 'review' }));
  assert.deepStrictEqual([activity.action.tool, Object.keys(activity.pending), activity.skills.map((s) => s.name)], ['Skill', ['s1'], ['review']]);
});

test('workflowProgress reads started and finished agents from the journal', () => {
  const journal = [line({ type: 'launched' }), line({ type: 'started', agentId: 'a1', label: 'fr:ide', phase: 'Traduire' }), line({ type: 'started', agentId: 'a2', label: 'en' }), line({ type: 'result', agentId: 'a1' })].join('\n');
  const progress = workflowProgress(journal);
  assert.deepStrictEqual(progress.started.get('a1'), { label: 'fr:ide', phase: 'Traduire' });
  assert.deepStrictEqual([...progress.done], ['a1']);
});

const now = 10 * 3600 * 1000;
const activity = (extra = {}) => ({ ...emptyActivity(), action: { tool: 'Bash', detail: 'x' }, ...extra });
const agent = (id, extra = {}) => ({ id, workflowId: null, meta: { description: id, agentType: 'general-purpose', requestShape: 'background' }, activity: activity(), mtime: now - 1000, started: now - 60000, ...extra });
const main = (extra = {}) => ({ task: 'Task', status: 'working', action: { tool: 'Agent', detail: 'd' }, activity: emptyActivity(), ...extra });

test('agentTree nests subagents under their parent and workflow agents under their workflow', () => {
  const agents = [
    agent('a1'),
    agent('a2', { meta: { description: 'child', parentAgentId: 'a1' }, started: now - 30000 }),
    agent('w1', { workflowId: 'wf_x', meta: { description: 'step', workflowPhase: 'Review', agentType: 'workflow-subagent', requestShape: 'foreground' } }),
  ];
  const tree = agentTree({ main: main(), agents, workflows: new Map([['wf_x', workflowProgress('')]]), now });
  assert.strictEqual(tree.state, 'running');
  assert.deepStrictEqual(tree.children.map((c) => c.id), ['a1', 'wf_x']);
  assert.deepStrictEqual(tree.children[0].children.map((c) => c.label), ['child']);
  assert.deepStrictEqual([tree.children[1].kind, tree.children[1].phase, tree.children[1].children[0].state], ['workflow', 'Review', 'running']);
  assert.strictEqual(countRunning(tree), 3);
});

test('agentTree marks acting agents, keeps recent finished ones and drops stale or old ones', () => {
  const agents = [
    agent('pending', { activity: activity({ pending: { t: now - 120000 } }), mtime: now - 120000 }),
    agent('stuck', { activity: activity({ pending: { t: now - 20 * 60000 } }), mtime: now - 20 * 60000 }),
    agent('fresh', { mtime: now - 2000 }),
    agent('done', { meta: { description: 'done', finished: true }, mtime: now - 60000 }),
    agent('old-done', { meta: { finished: true }, mtime: now - 10 * 60000 }),
    agent('stale', { mtime: now - 40 * 60000 }),
  ];
  const tree = agentTree({ main: main({ task: null, status: 'done', activity: null }), agents, workflows: new Map(), now });
  const byId = Object.fromEntries(tree.children.map((c) => [c.id, c]));
  assert.deepStrictEqual(Object.keys(byId).sort(), ['done', 'fresh', 'pending', 'stuck']);
  assert.deepStrictEqual([byId.pending.acting, byId.stuck.acting, byId.fresh.acting], [true, false, true]);
  assert.deepStrictEqual([byId.done.state, byId.done.acting, byId.done.action], ['done', false, null]);
  assert.deepStrictEqual([tree.state, tree.label, tree.skills], ['idle', 'Session', []]);
});

test('a foreground agent is done once the main agent stops working', () => {
  const foreground = agent('f', { meta: { requestShape: 'foreground' } });
  assert.strictEqual(agentTree({ main: main(), agents: [foreground], workflows: new Map(), now }).children[0].state, 'running');
  assert.strictEqual(agentTree({ main: main({ status: 'needs_input' }), agents: [foreground], workflows: new Map(), now }).children[0].state, 'running');
  assert.strictEqual(agentTree({ main: main({ status: 'done' }), agents: [foreground], workflows: new Map(), now }).children[0].state, 'done');
});

test('a workflow agent counts as done once the journal has its result', () => {
  const workflows = new Map([['wf_y', workflowProgress(line({ type: 'result', agentId: 'w2' }))]]);
  const tree = agentTree({ main: main(), agents: [agent('w2', { workflowId: 'wf_y', meta: {} })], workflows, now });
  assert.deepStrictEqual([tree.children[0].state, tree.children[0].children[0].state], ['done', 'done']);
});

test('skills hang under their agent, active while it runs', () => {
  const skills = [{ name: 'prep', at: 1 }, { name: 'hexa-domain', at: 2 }];
  const tree = agentTree({ main: main({ activity: { ...emptyActivity(), skills } }), agents: [agent('d', { meta: { finished: true }, activity: activity({ skills: [{ name: 'review', at: 3 }] }) })], workflows: new Map(), now });
  assert.deepStrictEqual(tree.skills.map((s) => [s.kind, s.label, s.state]), [['skill', 'prep', 'running'], ['skill', 'hexa-domain', 'running']]);
  assert.deepStrictEqual(tree.children[0].skills.map((s) => [s.label, s.state]), [['review', 'done']]);
});

test('notifications, command output, interruptions and compaction summaries are not human prompts', () => {
  const base = [prompt('<command-message>prep</command-message>\n<command-name>/prep</command-name>\n<command-args>x</command-args>'), use('s1', 'Skill', { skill: 'hexa' })];
  const noise = [
    line({ type: 'user', origin: { kind: 'task-notification' }, message: { content: '<task-notification><task-id>t</task-id></task-notification>' } }),
    line({ type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' } }),
    line({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
    line({ type: 'user', isCompactSummary: true, message: { content: 'This session is being continued' } }),
  ];
  const activity = agentActivity([...base, ...noise].join('\n'));
  assert.deepStrictEqual([activity.prompt, activity.skills.map((s) => s.name)], ['/prep x', ['prep', 'hexa']]);
  assert.strictEqual(agentActivity(line({ type: 'user', origin: { kind: 'human' }, message: { content: 'go' } })).prompt, 'go');
});

test('the incremental reader keeps accented characters split across reads', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { follow } = require('../server/features/agents');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-')), 'a.jsonl');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  const bytes = Buffer.from(`${prompt('réécris é')}\n`);
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  const read = () => follow(file, fs.statSync(file), 1 << 20, emptyActivity, (a, text) => applyText(a, text), 0);
  fs.writeFileSync(file, bytes.subarray(0, split));
  assert.strictEqual(read().prompt, null);
  fs.appendFileSync(file, bytes.subarray(split));
  assert.strictEqual(read().prompt, 'réécris é');
});
