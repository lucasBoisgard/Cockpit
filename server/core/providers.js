const { patchFiles } = require('../../hooks/state-transition');

// Agent providers, without I/O: how to launch and resume a session of each command-line agent, which
// models and permission modes it offers, which keys answer its approval prompt, and how to read its
// transcript. Claude Code is the default; Codex brings the OpenAI GPT models.

const PROVIDER_IDS = ['claude', 'codex'];
const HOOK_EVENTS_CODEX = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'];
const CHAT_MAX_ITEMS = 400;

const CLAUDE_MODELS = ['opus', 'opus[1m]', 'sonnet', 'sonnet[1m]', 'haiku', 'fable'];
const CODEX_DEFAULT_MODELS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

const PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    modes: ['default', 'acceptEdits', 'auto', 'plan'],
    keys: { allow: { literal: '1' }, always: { literal: '2' }, deny: { literal: '3' } },
  },
  codex: {
    id: 'codex',
    label: 'GPT (Codex)',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    modes: ['default', 'acceptEdits', 'auto', 'plan'],
    keys: { allow: { literal: 'y' }, always: { literal: 'a' }, deny: { key: 'Escape' } },
  },
};

const providerOf = (id) => PROVIDERS[id || 'claude'] || null;

function validateSettings(providerId, { model, effort, mode } = {}, models) {
  const provider = providerOf(providerId);
  if (!provider) return { error: `Fournisseur inconnu : ${providerId} (${PROVIDER_IDS.join(', ')}).` };
  const claude = provider.id === 'claude';
  const m = model ? (claude ? String(model).trim().toLowerCase() : String(model).trim()) : null;
  // `models`: ids, or catalog entries { id, efforts } when the provider says which efforts each model takes.
  const catalog = (models || (claude ? CLAUDE_MODELS : CODEX_DEFAULT_MODELS)).map((x) => (typeof x === 'string' ? { id: x } : x));
  const entry = m ? catalog.find((x) => x.id === m) : null;
  if (m && !entry) return { error: `Modèle inconnu pour ${provider.label} : ${model} (${catalog.map((x) => x.id).join(', ')}).` };
  const e = effort ? String(effort).toLowerCase() : null;
  const efforts = entry?.efforts?.length ? entry.efforts : provider.efforts;
  if (e && !efforts.includes(e)) return { error: `Effort ${effort} non disponible${m ? ` pour ${m}` : ''} (${efforts.join(', ')}).` };
  const md = mode ? String(mode) : null;
  if (md && !provider.modes.includes(md)) return { error: `Mode de permission refusé : ${mode} (${provider.modes.join(', ')}).` };
  return { provider: provider.id, model: m, effort: e, mode: md };
}

// Codex permissions: the sandbox and approval policy that match a cockpit mode.
function codexModeArgs(mode) {
  if (mode === 'plan') return ['-s', 'read-only', '-a', 'on-request'];
  if (mode === 'auto') return ['--approve-for-me'];
  return ['-s', 'workspace-write', '-a', 'on-request'];
}

// The cockpit's state hook, given per session so nothing is written in ~/.codex. Codex runs it once the
// user has trusted it with /hooks (trust is kept per hook content).
function codexHookArgs(hookCommand) {
  const literal = `'${String(hookCommand).replace(/'/g, '')}'`;
  return HOOK_EVENTS_CODEX.flatMap((event) => ['-c', `hooks.${event}=[{hooks=[{type="command",command=${literal},timeout=10}]}]`]);
}

// Arguments of the provider's binary. A Claude resume always carries its mode, `default` included: without
// the flag Claude Code restores the mode stored in the session. `rules` is the cockpit's system prompt: Claude takes it as an
// appended system prompt; `disallow` and `allow` are variadic flags, so another flag must follow them; Codex has none, so the rules lead the first message.
function launchArgs(providerId, o) {
  if (providerId === 'codex') {
    const prompt = o.rules && !o.resume ? [`[Consignes du cockpit]\n${o.rules}`, o.prompt ? `[Ta tâche]\n${o.prompt}` : ''].filter(Boolean).join('\n\n') : o.prompt;
    return [
      ...(o.resume ? ['resume'] : []),
      ...codexHookArgs(o.hookCommand),
      ...(o.model ? ['-m', o.model] : []),
      ...(o.effort ? ['-c', `model_reasoning_effort="${o.effort}"`] : []),
      ...codexModeArgs(o.mode),
      ...(o.addDirs || []).flatMap((d) => ['--add-dir', d]),
      ...(o.resume ? [o.sessionId] : []),
      ...(prompt ? [prompt] : []),
    ];
  }
  return [
    ...(o.newWorktree ? ['--worktree', o.newWorktree] : []),
    ...(o.allow?.length ? ['--allowedTools', ...o.allow] : []),
    ...(o.disallow?.length ? ['--disallowedTools', ...o.disallow] : []),
    ...(o.resume ? ['--resume', o.sessionId] : o.sessionId ? ['--session-id', o.sessionId] : []),
    ...(o.name ? ['--name', o.name] : []),
    ...(o.rules ? ['--append-system-prompt', o.rules] : []),
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
    ...(o.mode ? ['--permission-mode', o.mode] : []),
    ...(o.prompt ? [o.prompt] : []),
  ];
}

function codexText(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((c) => (typeof c === 'string' ? c : c.text || '')).filter(Boolean).join('\n');
}

function codexToolDetail(name, rawArgs) {
  let args = rawArgs;
  if (typeof rawArgs === 'string') {
    try { args = JSON.parse(rawArgs); } catch { args = rawArgs; }
  }
  if (name === 'apply_patch') return patchFiles(typeof args === 'string' ? args : args?.input).join(', ');
  const command = args?.command ?? args?.cmd;
  if (command) return Array.isArray(command) ? command.join(' ') : String(command);
  return typeof args === 'string' ? args.slice(0, 200) : JSON.stringify(args || {}).slice(0, 200);
}

// Codex rollout (JSON lines {timestamp, type, payload}) → the cockpit's chat items. The format is not
// a stable interface: unknown lines are skipped.
function parseCodexRollout(text, sessionId) {
  const items = [];
  const calls = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const p = entry.payload || {};
    const at = Date.parse(entry.timestamp) || null;
    if (entry.type !== 'response_item') continue;
    if (p.type === 'message') {
      const body = codexText(p.content).trim();
      if (!body) continue;
      if (p.role === 'assistant') items.push({ kind: 'assistant', text: body, at });
      else if (p.role === 'user' && !/^<[a-z_]+>/.test(body)) items.push({ kind: 'user', text: body.replace(/^\[Consignes du cockpit\][\s\S]*?\[Ta tâche\]\n/, ''), at });
    } else if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(p.type)) {
      const name = p.name || (p.type === 'local_shell_call' ? 'shell' : 'tool');
      const tool = { kind: 'tool', tool: name === 'shell' || name === 'exec_command' ? 'Bash' : name, detail: codexToolDetail(name, p.arguments ?? p.input ?? p.action), at };
      if (p.call_id) calls.set(p.call_id, tool);
      items.push(tool);
    } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type) && calls.has(p.call_id)) {
      const out = typeof p.output === 'string' ? p.output : codexText(p.output?.content) || JSON.stringify(p.output || '');
      calls.get(p.call_id).result = out.length > 4000 ? `${out.slice(0, 4000)}\n…` : out;
    }
  }
  return { sessionId, total: items.length, items: items.slice(-CHAT_MAX_ITEMS) };
}

module.exports = { PROVIDER_IDS, PROVIDERS, CLAUDE_MODELS, CODEX_DEFAULT_MODELS, providerOf, validateSettings, codexModeArgs, codexHookArgs, launchArgs, parseCodexRollout };
