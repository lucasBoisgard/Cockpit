---
name: worktree-session
description: Rules for a Claude Code session running in a worktree (<repo>/.claude/worktrees/<name>) while other sessions work in parallel on the same machine. Use when the working directory is under .claude/worktrees/, and whenever the session start says to load it.
user-invocable: false
---

# Worktree session

The session start lists this repo's own rules (shared resources, setup, refused commands), taken from the `worktrees` section of the cockpit configuration. They come on top of the table below.

| Topic | Rule |
|---|---|
| Where you are | `<repo>/.claude/worktrees/<name>`, on the branch `worktree-<name>` that Claude Code created |
| Branch | Rename it before opening a PR (`git branch -m <type>/<ticket>-<description>`). To stack on an existing PR, check out that PR's branch, unless another worktree already holds it |
| Setup | Do what the session start says is missing (installing dependencies, building internal packages) before running tests |
| Shared resources | Databases, queues and the running app are shared with the other sessions. Tests that roll back their changes are fine. Never reset, seed, migrate or drop shared data |
| Refused commands | The cockpit refuses the commands listed at session start; do not work around the refusal, ask the user |
| App and QA | Do not start the app from a worktree. QA in the running app is asked of the user, or done through the `run-app` skill, which serves a worktree from the main checkout |
| Environment files | Copied into the worktree when it was created (`.worktreeinclude`); never edit the main checkout's copies |
| Git stash | The stash stack is shared by every worktree: no bare `git stash` / `git stash pop`; prefer a temporary WIP commit |
| End | Push your commits before the worktree is removed: it goes away with them |
