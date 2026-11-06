const CHAT_MAX_ITEMS = 400;
const TOOL_RESULT_MAX_CHARS = 3000;
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return '';
}

function userText(raw) {
  const command = raw.match(/<command-name>([^<]+)<\/command-name>/);
  if (command) {
    const args = raw.match(/<command-args>([^<]*)<\/command-args>/);
    return `${command[1]}${args && args[1] ? ` ${args[1]}` : ''}`;
  }
  const cleaned = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!cleaned || /^<(local-command|bash-|task-notification)/.test(cleaned)) return null;
  return cleaned;
}

function summarizeToolInput(input = {}) {
  if (Array.isArray(input.questions)) return input.questions.map((q) => q?.question).filter(Boolean).join(' · ') || 'Question';
  return input.description || input.command || input.file_path || input.pattern || input.prompt || input.skill || input.url || input.query || JSON.stringify(input).slice(0, 200);
}

function* entriesOf(text) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

function parseChat(text, sessionId) {
  const items = [];
  const tools = new Map();
  for (const entry of entriesOf(text)) {
    if (entry.isSidechain || entry.isMeta || !entry.message) continue;
    const at = Date.parse(entry.timestamp) || null;
    const content = entry.message.content;
    if (entry.type === 'user') {
      if (typeof content === 'string') {
        const userLine = userText(content);
        if (userLine) items.push({ kind: 'user', text: userLine, at });
        continue;
      }
      for (const block of content || []) {
        if (block.type === 'tool_result' && tools.has(block.tool_use_id)) {
          const result = textOf(block.content);
          const tool = tools.get(block.tool_use_id);
          tool.result = result.length > TOOL_RESULT_MAX_CHARS ? `${result.slice(0, TOOL_RESULT_MAX_CHARS)}\n…` : result;
          tool.error = !!block.is_error;
        } else if (block.type === 'text') {
          const userLine = userText(block.text);
          if (userLine) items.push({ kind: 'user', text: userLine, at });
        }
      }
    } else if (entry.type === 'assistant') {
      for (const block of content || []) {
        if (block.type === 'text' && block.text.trim()) items.push({ kind: 'assistant', text: block.text, at });
        if (block.type === 'tool_use') {
          const tool = { kind: 'tool', tool: block.name, detail: String(summarizeToolInput(block.input)), at };
          tools.set(block.id, tool);
          items.push(tool);
        }
      }
    }
  }
  return { sessionId, total: items.length, items: items.slice(-CHAT_MAX_ITEMS) };
}

function parseHistoryMeta(text, { sessionId, file, mtimeMs }) {
  const meta = { sessionId, file, cwd: null, branch: null, title: null, messages: 0, files: new Set(), startedAt: null, lastAt: mtimeMs };
  for (const entry of entriesOf(text)) {
    if (entry.isSidechain || !entry.message) continue;
    meta.cwd = meta.cwd || entry.cwd || null;
    meta.branch = entry.gitBranch || meta.branch;
    const at = Date.parse(entry.timestamp);
    if (at) {
      meta.startedAt = meta.startedAt || at;
      meta.lastAt = at;
    }
    const content = entry.message.content;
    if (entry.type === 'user' && !entry.isMeta) {
      const userLine = typeof content === 'string' ? userText(content) : null;
      if (userLine) {
        meta.messages += 1;
        meta.title = meta.title || userLine.slice(0, 160);
      }
    } else if (entry.type === 'assistant') {
      for (const block of content || []) {
        if (block.type === 'text') meta.messages += 1;
        if (block.type === 'tool_use' && EDIT_TOOLS.includes(block.name) && block.input?.file_path && meta.files.size < 30) meta.files.add(block.input.file_path);
      }
    }
  }
  return { ...meta, files: [...meta.files].map((f) => (meta.cwd && f.startsWith(`${meta.cwd}/`) ? f.slice(meta.cwd.length + 1) : f)) };
}

function searchSnippet(text, index, length) {
  if (index < 0) return '';
  return text.slice(Math.max(0, index - 80), index + length + 120).replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/[{}"\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { EDIT_TOOLS, textOf, userText, summarizeToolInput, parseChat, parseHistoryMeta, searchSnippet };
