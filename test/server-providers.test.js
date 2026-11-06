const test = require('node:test');
const assert = require('node:assert');
const p = require('../server/core/providers');

test('validateSettings checks models, efforts and modes per provider', () => {
  assert.deepStrictEqual(p.validateSettings('claude', { model: 'Sonnet', effort: 'HIGH', mode: 'plan' }), { provider: 'claude', model: 'sonnet', effort: 'high', mode: 'plan' });
  assert.deepStrictEqual(p.validateSettings('codex', { model: 'gpt-6.1-sol', effort: 'ultra' }), { provider: 'codex', model: 'gpt-6.1-sol', effort: 'ultra', mode: null });
  assert.ok(p.validateSettings('codex', { model: 'opus' }).error);
  assert.ok(p.validateSettings('claude', { effort: 'ultra' }).error);
  assert.ok(p.validateSettings('claude', { mode: 'bypassPermissions' }).error);
  assert.ok(p.validateSettings('gemini', {}).error);
  assert.deepStrictEqual(p.validateSettings('codex', { model: 'gpt-x' }, ['gpt-x']).model, 'gpt-x');
});

test('claude arguments keep the variadic --allowedTools away from the prompt', () => {
  const args = p.launchArgs('claude', { allow: ['Bash(x:*)'], sessionId: 'id', name: 'w1', rules: 'R', model: 'sonnet', effort: 'high', mode: 'acceptEdits', prompt: 'Fais X' });
  assert.deepStrictEqual(args, ['--allowedTools', 'Bash(x:*)', '--session-id', 'id', '--name', 'w1', '--append-system-prompt', 'R', '--model', 'sonnet', '--effort', 'high', '--permission-mode', 'acceptEdits', 'Fais X']);
  assert.deepStrictEqual(p.launchArgs('claude', { resume: true, sessionId: 'id', prompt: 'go' }), ['--resume', 'id', 'go']);
});

test('codex arguments carry the hooks, the settings, a safe sandbox and the rules in the first message', () => {
  const args = p.launchArgs('codex', { hookCommand: 'node /c/hooks/worktree-state.js codex', model: 'gpt-6-luna', effort: 'high', mode: 'acceptEdits', rules: 'R', prompt: 'Fais X' });
  assert.ok(args.includes(`hooks.Stop=[{hooks=[{type="command",command='node /c/hooks/worktree-state.js codex',timeout=10}]}]`));
  assert.ok(!args.some((a) => /dangerously/.test(a)));
  assert.deepStrictEqual(args.slice(-9), ['-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="high"', '-s', 'workspace-write', '-a', 'on-request', '[Consignes du cockpit]\nR\n\n[Ta tâche]\nFais X']);
  const resume = p.launchArgs('codex', { resume: true, sessionId: 's1', hookCommand: 'h', mode: 'plan', prompt: 'suite' });
  assert.strictEqual(resume[0], 'resume');
  assert.deepStrictEqual(resume.slice(-6), ['-s', 'read-only', '-a', 'on-request', 's1', 'suite']);
  assert.deepStrictEqual(p.codexModeArgs('auto'), ['--approve-for-me']);
});

test('parseCodexRollout keeps the conversation, tools and their output, and hides the cockpit rules', () => {
  const lines = [
    { type: 'session_meta', payload: { id: 's1' } },
    { timestamp: '2026-11-06T10:00:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { timestamp: '2026-11-06T10:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[Consignes du cockpit]\nR\n\n[Ta tâche]\nListe les fichiers' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["ls","-la"]}', call_id: 'c1' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'a.js' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: b.js\n+x\n*** End Patch', call_id: 'c2' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'doublon' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fini.' }] } },
  ].map((l) => JSON.stringify(l)).join('\n');
  const chat = p.parseCodexRollout(`${lines}\nnot json`, 's1');
  assert.deepStrictEqual(chat.items.map((i) => [i.kind, i.text || `${i.tool} ${i.detail}`]), [['user', 'Liste les fichiers'], ['tool', 'Bash ls -la'], ['tool', 'apply_patch b.js'], ['assistant', 'Fini.']]);
  assert.strictEqual(chat.items[1].result, 'a.js');
});
