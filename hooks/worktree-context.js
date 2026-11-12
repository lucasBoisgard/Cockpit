#!/usr/bin/env node
// SessionStart: in a worktree of the configured repo, injects the worktree rules into the session's context.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { loadConfig, worktreeOf, settingsOf, contextLines } = require('./worktree-rules');

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {}
const cwd = input.cwd || process.cwd();
const config = loadConfig();
const worktree = worktreeOf(cwd, config.repo);
if (worktree) {
  let branch = null;
  try {
    branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}
  console.log(contextLines({ worktree, branch, settings: settingsOf(config), exists: fs.existsSync }).join('\n'));
}
