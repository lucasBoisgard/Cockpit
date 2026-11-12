# House rules

The user's standing rules for every agent. Copy this file to `~/.claude/house-rules.md` and adapt it: `agent-protocol` makes every orchestrated agent read it, then `~/.claude/house-rules.local.md` (rules for one machine only, such as a company's tools and conventions). Role skills cite a rule by its ID and never restate it. One rule = one sentence, grep-able. Keep the IDs: skills cite them.

## Outward actions
- H1 Never post on a PR, a chat or a ticket tracker: write drafts, the user posts. Never run anything in prod either: hand over the query.

## Git
- H2 No `git add` or `git commit` without an explicit order; leave changes unstaged for review.
- H3 No amend, no force-push, no rebase: merge the base branch into the working branch.

## CI and review
- H4 CI must be green after every push, except on a "do not merge" PR: watch it and fix reds.
- H5 Run an independent review after any code, fixes included, and fix every finding before handing back.

## Pull request form
- H6 No AI attribution in commits or PRs (no Co-Authored-By, no "Generated with" footer).
- H10 PR form: series titled [n/N], up to date with its base (fetch + merge) before `gh pr create`; the repository's own conventions (labels, assignee, description template) come from its project memory or instructions.

## Language and tone
- H7 English in the codebase (code, comments, skills, PRs); the user's language in the conversation.
- H8 Short structured answers: verdict first, one idea per line, no big text blocks.
- H9 Drafts a human will read sound human: short (3 lines max), no AI tone, point to the code.

## Data and privacy
- H13 No real user PII (names, emails) in code, comments or files: UUIDs only.
