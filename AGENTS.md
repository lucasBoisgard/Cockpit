# Cockpit collaboration rules

- Continue in the current Cockpit worktree and branch. Do not create a replacement worktree or branch just to make the same changes visible elsewhere.
- Before merging or pushing, inspect `git status`, branch names, and commit ancestry in both the worktree and the shared checkout. Never claim changes were merged or pushed unless a commit containing them is on the target branch and the push succeeded.
- Preserve uncommitted work. Do not reset, discard, or overwrite changes from another session.
- Keep provider-specific behavior isolated. Codex compatibility changes must not alter Claude session behavior; add explicit provider checks and cover both paths where practical.
- If the user asks to commit and push, commit the reviewed changes from the current Cockpit worktree, fast-forward the shared `main` checkout only when clean, and push `main`.
