#!/usr/bin/env node
// PreToolUse (Bash): in a worktree of the configured repo, refuses the commands listed in `worktrees.forbidden`
// (typically the ones that touch resources shared by every session: databases, the running app).
const fs = require('node:fs');
const { loadConfig, worktreeOf, settingsOf, forbiddenLabel } = require('./worktree-rules');

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
if (input.tool_name !== 'Bash') process.exit(0);
const config = loadConfig();
if (!worktreeOf(input.cwd || process.cwd(), config.repo)) process.exit(0);
const label = forbiddenLabel(input.tool_input?.command, settingsOf(config));
if (label) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Refused in a worktree (${label}): it touches what the parallel sessions share. Ask the user.` } }));
}
