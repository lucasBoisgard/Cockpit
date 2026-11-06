# Working on the cockpit

Several Claude sessions may change the cockpit at the same time. `~/.claude/worktree-dashboard` is the shared checkout: it stays on `main` and runs the live instance. Never edit it directly.

- Work on a branch in its own git worktree: `git -C ~/.claude/worktree-dashboard worktree add -b feat/<slug> ~/.claude/worktree-dashboard-worktrees/<slug> main`, then edit only there.
- Test on a temporary port: symlink `token` and `cockpit.config.json` from the shared checkout (both git-ignored), then run `PORT=47xx HOST=127.0.0.1 node server.js`. Without `COCKPIT_TICK=1` it does not run the background loop, so it never sends queued messages, runs automations or records events in parallel with the live instance: keep it that way. Never restart the live instance yourself.
- Put code where its feature lives: one file per feature in `server/features/`, `web/js/` and `web/css/`. Decisions without I/O go in `server/core/` (or `hooks/state-transition.js`) with a `node:test` case in `test/`; run `node --test` before committing.
- Give the classes of a new UI component a prefix of its own (for example `reader-`, `alert-`): styles are global, and generic names like `.note` or `.task` have already restyled other parts of the page.
- `web/js/` scripts are classic scripts loaded in order from `index.html` and share one global scope: declare what a file uses at load time in an earlier file, and keep a feature's listeners in its own file.
- Commit, push and merge into `main` only when the user asks. Merge from the shared checkout when its working tree is clean, then the user reloads with the "Recharger le cockpit" button.
- Remove the worktree once the branch is merged: `git -C ~/.claude/worktree-dashboard worktree remove ~/.claude/worktree-dashboard-worktrees/<slug>`.
- Never remove the worktree your own session runs in: the cockpit shows a session's card from its worktree, and removing it hides the session. To keep working after a merge, create the next branch inside that same worktree (`git checkout -b feat/<next> main`).
- Delete a branch as soon as it is merged, locally and on GitHub: `git -C ~/.claude/worktree-dashboard branch -d feat/<slug>` and `git -C ~/.claude/worktree-dashboard push origin --delete feat/<slug>` when it was pushed.
