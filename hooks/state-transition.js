const path = require('node:path');
const { questionsOf } = require('./ask');

const MAX_ACTIONS = 15;
const MAX_EDITED_DIRS = 20;
const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];

function shorten(text, max = 140) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

// Codex edits files with apply_patch: the paths are in the patch headers.
function patchFiles(patch) {
  return [...String(patch || '').matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
}

function editedDir(input, cwd) {
  const file = EDIT_TOOLS.includes(input.tool_name) ? input.tool_input?.file_path || input.tool_input?.notebook_path
    : input.tool_name === 'apply_patch' ? patchFiles(input.tool_input?.command || input.tool_input?.input)[0] : null;
  return file ? path.dirname(path.resolve(cwd, String(file))) : null;
}

function questionOf(input = {}) {
  const first = Array.isArray(input.questions) ? input.questions[0] : null;
  if (!first) return null;
  return { text: shorten(first.question, 220), options: (first.options || []).map((o) => shorten(o.label, 60)).slice(0, 6), multi: !!first.multiSelect };
}

function describeTool(name, input = {}, cwd) {
  const rel = (p) => (p ? path.relative(cwd, path.resolve(cwd, p)) || p : '');
  switch (name) {
    case 'Bash':
      return shorten(input.description || input.command);
    case 'apply_patch':
      return patchFiles(input.command || input.input).map(rel).join(', ');
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return rel(input.file_path || input.notebook_path);
    case 'Grep':
    case 'Glob':
      return shorten(input.pattern);
    case 'Agent':
    case 'Task':
      return shorten(input.description);
    case 'Skill':
      return input.skill || '';
    case 'WebFetch':
      return shorten(input.url);
    case 'WebSearch':
      return shorten(input.query);
    default:
      return '';
  }
}

function applyHookEvent(state, input, { now, pane, fallbackCwd, provider, launch }) {
  const cwd = input.cwd || state.cwd || fallbackCwd;
  state.sessionId = input.session_id;
  if (provider && provider !== 'claude') state.provider = provider;
  if (input.model) state.model = String(input.model);
  if (launch && (!state.launch || input.hook_event_name === 'SessionStart')) state.launch = launch;
  state.cwd = cwd;
  state.transcriptPath = input.transcript_path || state.transcriptPath;
  if (input.hook_event_name === 'SessionStart' || (pane && pane !== state.tmuxPane)) {
    if (pane !== state.tmuxPane) state.tmuxPaneSince = now;
    state.tmuxPane = pane;
  }
  const previous = { status: state.status, since: state.statusSince || state.updatedAt || now, updatedAt: state.updatedAt || now };
  state.startedAt = state.startedAt || now;
  state.updatedAt = now;

  switch (input.hook_event_name) {
    case 'SessionStart':
      state.status = !state.status || (['startup', 'resume'].includes(input.source) && ['working', 'needs_input'].includes(state.status)) ? 'idle' : state.status;
      break;
    case 'UserPromptSubmit':
      state.status = 'working';
      state.turnStartedAt = now;
      state.task = state.task || shorten(input.prompt, 220);
      state.lastPrompt = shorten(input.prompt, 220);
      state.message = null;
      state.question = null;
      break;
    case 'PreToolUse': {
      const edited = editedDir(input, cwd);
      const added = !!edited && !(state.editedDirs || []).includes(edited);
      if (edited) state.editedDirs = [edited, ...(state.editedDirs || []).filter((dir) => dir !== edited)].slice(0, MAX_EDITED_DIRS);
      if (input.agent_id) {
        if (state.status === 'needs_input' && state.permission) Object.assign(state, { status: 'working', message: null, permission: false });
        else if (state.status !== 'working') {
          state.updatedAt = previous.updatedAt;
          return added && !!state.status;
        }
        break;
      }
      const files = input.tool_name === 'apply_patch' ? patchFiles(input.tool_input?.command || input.tool_input?.input) : [];
      state.actions = [{ tool: input.tool_name, detail: describeTool(input.tool_name, input.tool_input, cwd), ...(files.length ? { files } : {}), at: now }, ...(state.actions || [])].slice(0, MAX_ACTIONS);
      if (input.tool_name === 'AskUserQuestion' || (provider === 'codex' && input.tool_name === 'request_user_input')) {
        state.question = questionOf(input.tool_input);
        state.questions = questionsOf(input.tool_input);
        state.status = 'needs_input';
        state.message = state.question?.text || (provider === 'codex' ? 'GPT pose une question' : 'Claude pose une question');
      } else {
        state.status = 'working';
        state.message = null;
        state.question = null;
        state.questions = null;
        state.permission = false;
      }
      break;
    }
    case 'Notification':
      if (input.notification_type === 'idle_prompt' || /waiting for your input/i.test(input.message || '')) return false;
      // Claude Code also notifies "needs your permission to use AskUserQuestion": it is the question, not a permission.
      if (state.question && state.status === 'needs_input' && /AskUserQuestion/.test(input.message || '')) return false;
      state.status = 'needs_input';
      state.message = shorten(input.message, 220);
      state.permission = /permission/i.test(input.message || '');
      break;
    // Codex: the approval prompt has its own event, and the tool result tells the approval was given.
    case 'PermissionRequest': {
      const what = describeTool(input.tool_name, input.tool_input, cwd) || input.tool_input?.description || '';
      state.status = 'needs_input';
      state.permission = true;
      state.message = shorten(`Permission : ${input.tool_name}${what ? ` · ${what}` : ''}`, 220);
      break;
    }
    // The tool ran: its question was answered or its permission granted, the turn goes on.
    case 'PostToolUse':
      if (state.status !== 'needs_input' || !(state.permission || state.question)) return false;
      Object.assign(state, { status: 'working', message: null, permission: false, question: null, questions: null });
      break;
    case 'Interrupt':
      Object.assign(state, { status: 'idle', message: null, question: null, permission: false });
      break;
    case 'Stop':
      if (input.stop_hook_active) return false;
      state.status = 'done';
      state.message = null;
      state.question = null;
      state.permission = false;
      if (input.last_assistant_message) state.lastAssistant = shorten(input.last_assistant_message, 400);
      break;
    case 'SessionEnd':
      state.status = 'ended';
      break;
    default:
      return false;
  }

  const restarted = previous.status === 'working' && (input.hook_event_name === 'UserPromptSubmit' || (input.hook_event_name === 'SessionStart' && state.status !== 'working'));
  if (state.status !== previous.status || restarted) {
    if (previous.status === 'working') state.workedMs = (state.workedMs || 0) + Math.max(0, (restarted ? previous.updatedAt : now) - previous.since);
    state.statusSince = now;
  }
  return true;
}

module.exports = { shorten, patchFiles, applyHookEvent };
