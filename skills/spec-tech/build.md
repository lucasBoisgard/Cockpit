# Build and land

Phases 3 and 4 of the `spec-tech` skill. Prerequisites: the plan `.scratch/<KEY>-slices.md` exists, the trunk and its draft PR exist, and the team has reviewed the plan. Otherwise stop and say so: building on an unreviewed split means re-splitting after three slices.

A single-PR ticket does not go through here: one branch on the base, one PR, that is all (step B alone, without a stack).

## Rules that take precedence

- "Build", "implement slice n", "implement the plan" count as the order to commit and open PRs for those slices (H2). Nothing else is committed without an order.
- **Exception to H3 on stack layers.** On the layer branches of a `spec-tech` stack, restacking (`gh stack sync`, `gh stack push`, or `git rebase` + `git push --force-with-lease`) is allowed, always `--force-with-lease`, never `--force`. Everywhere else (trunk, default branch, effort branch, PRs outside the stack), H3 holds: merge, never force-push.
  - Before the first force-push of a stack: `gh api repos/{owner}/{repo}/branches/<branch>/protection` ("Dismiss stale approvals" would lose the approvals; if it is on, warn the user).
- In the stack model: never merge the base into a layer. A layer is the target only of the layer above: a fix to layer n is a new layer, not a PR into layer n.
- After any code produced: independent review (`pr-reviewer`), then fix all its findings before pushing (H5).
- After every push: `pr-ci-keeper`, CI green, no red tolerated except the scratch-file guard on the trunk (H4).
- PR form: title `feat: [<KEY>] [n/N] <slice>`, labels and assignee from the cockpit config `pr` when set, otherwise the house rules, body in English with the repo's template (H6, H10).
- In a Cockpit master session, agents are launched with `orchestrate launch`, not the Agent tool.

## A. Orchestrate the plan

The orchestrator plans, launches, escalates the questions and lands. It never codes a feature itself.

### Take stock (resuming is possible)

Read the plan: conventions, gate, and for each slice its branch, its base, its dependencies. Then the real state (`gh stack view --json` if the stack exists, otherwise `gh pr list --head <branch> --state all` per slice):
- **done**: PR merged into the trunk;
- **in progress**: PR open;
- **to do**: no PR.

A slice that already has a PR is never relaunched: that is what lets a half-built plan resume.

Clean up the worktrees left by a previous run: `git worktree prune`, then `git worktree remove --force` on any `agent-*` worktree whose slice already has its PR. A killed agent leaves a locked worktree that blocks the branch.

### Initialise the stack, once

`gh extension list`: if `gh stack` is missing, install it (`gh extension install github/gh-stack`, gh ≥ 2.90) or announce that the whole run uses plain git. Never mix the two.

`gh stack init --base <prefix>/<KEY>`, here and not in the agents: two agents creating the stack at the same time is the classic failure.

### Launch the slices in dependency order

A slice is **ready** when each slice it depends on is done or in progress (an open PR gives it a branch to stack on). Mission order for the agent, three things only: the plan path, the slice number, its base (the previous slice's branch; the trunk for slice 1 or a slice marked independent). The agent follows step B.

- **Isolated worktree only when there is real parallelism.** A single ready slice (frequent with a linear chain) → no worktree. Several ready at the same time → one worktree per agent.
- **A worktree builds, it does not verify.** The app runs once, on the main checkout. Verifications are therefore serialised, one slice at a time, under the lock of the repo's QA procedure. Three agents in parallel = three builds in parallel and three verifications in a queue.
- No waves: as soon as a slice's dependencies have their PR, it starts.
- **First slice in the foreground** until the approach is proven; in the background afterwards.
- **Slow is not stuck**: judge an agent by its files, commits and pushed branch, never by the time of its transcript. 15 to 20 min without any file activity before killing and relaunching it.

### Escalate, do not guess

An agent stops on a "several ways to do it" fork, a design-system slot that does not take the layout, an unreachable mockup, a caller that would lose its behaviour, an unmet dependency, a size overrun. Pass its question to the user as is with the agent's recommendation, send the answer back, relaunch the agent. Never answer a design question in the user's place.

Each UI slice ends with a blocking stop (step B, Verify): relay the checklist as is, do not validate it yourself. Do not launch so many agents that four wait for the user's eyes at the same time.

### Reconcile and report

Each agent edits only its own slice's entry in the plan, plus one line in `Deviations log`. Any change touching several slices (merge, cut discovered on the way) comes back up and is made here, in one place.

As soon as an agent confirms the branch is pushed and the PR open: `git worktree remove --force <path>` then `git branch -D <branch>`. The branch lives on the remote.

When everything is in place: a table slice → PR → status, and what remains human (the reviews, then the landing).

## B. Build a slice

### 1. Take the slice as the mission order and cut its branch

Read the plan: conventions, gate, and slice n (scope, callers, design-system components and sizes, criteria, branch, base).
- **No trunk** → stop: the plan has not been reviewed. Do not create it yourself.
- **Base** = the previous slice's branch (linear chain). If it neither exists nor is already merged into the trunk → stop, the dependencies are not met.
- **Cut the branch**: `gh stack checkout <trunk | stack number | parent PR number>` then `gh stack add <prefix>/<KEY>-<desc>`. Never `gh stack init`, except solo on slice 1 with no existing stack. Without the extension: `git switch -c <prefix>/<KEY>-<desc> <base>` and `git config --global rebase.updateRefs true`.

### 2. Load the how and the design

- Follow the repo's ticket-process doc and the conventions touched (architecture guidelines, design-system skills for any UI).
- **Front end**: follow the repo's front-end guidance: never invent UI (Figma frame, stop if unreachable), reuse before adding (grep first, field-level renderers included; ask the user on a real fork, and the canonical form chosen is its own change), read the source and stories of each named component before the first line of markup.
- **Review the callers** of the `Surfaces` line yourself, the code may have moved since the plan. What a caller would lose is this slice's regression: preserve it, or if it is real unbudgeted work, stop and put it to the user with the size impact. Never a silent disappearance.
- **An empty search does not prove absence**: before declaring blocked, missing or unsupported, search again without `| head`, without a path filter, with two other plausible names.
- **Back end**: grep the existing commands, queries, entities, aggregates, value objects, repository ports and authorizers before creating one; one entry point (two = two slices, stop and re-split); name the other consumers of a port or entity you extend.

### 3. Implement, TDD, within scope

- **Back end**: TDD, red test first, green, then refactor. Extend what you found rather than adding a parallel one.
- **Front end**: tests only where the repo asks for them. Design-system components named in the slice. Exploration capped at ~10 min (the plan and the files you change), except the design pass, which is not shortened.
- **Shape from the first draft**: a component file ≤ ~200 lines; extract sections and hooks as you go; factor the second copy of a shape as soon as it appears; align exports and naming on the neighbouring files.
- If the diff goes over ~400 production lines or leaves its axis: stop, re-split, note it in the plan.

### 4. Verify

- Where to run commands: the repo's dev-environment guidance.
- **Back end**: tests, then type check, then build, for each project touched, with the repo's commands. Green or nothing; a failure is not a "known issue".
- **Front end**: type check and lint per package touched, never at the root.
- Format and lint the changed files before committing, with the repo's formatter on changed files only; on a pre-existing file, only the added lines.
- **Measure the diff** (production code, tests excluded) against the estimate. Over 400 → stop and re-split.
- **Runtime behaviour changed**: prove it on the running app through the repo's QA skill when it has one (highest rung possible, consent asked once, lock, report of the rungs reached or not), otherwise `run-app` and the user's eyes. A worktree is never what runs: verification happens on the main checkout (`run-app`).
- **UI slice: stop and hand over to the user**, with a short checklist, then wait:
  - the exact URL or click path;
  - each state named by the slice (loading, empty, error, each variant per role or flag), one line each;
  - for an overlay, the page under it still there and intact;
  - each touched `Surfaces` caller, which still does what it did;
  - the design gaps already known, with their reason.
  Their eye is the gate. Fix what comes back, redo the checklist, then only step 5.

### 5. Reconcile the plan

The plan is the living source of truth. If the slice changed something (split, merged, re-scoped, a part sent to a sibling ticket, data or design approach changed): rewrite the entry and the coverage in place, add a line to `Deviations log`. Never a second plan. The plan lives on the trunk: its update goes in the slice PR's diff and is reviewed with it.
- **A deviation line is not an approval**: a workaround of a design-system constraint should have been put to the user at step 2.
- **Keep the estimate next to the measure**: `Est. lines: ~90 → 180 measured`.
- **Review feedback on shared data** (link without uniqueness, nullable column, deleted row still linked) also goes into the slices not yet built that read the same place.
- **Everything built outside the plan** gets a coverage line (`plan` or `regression`) **and** its box in the trunk PR, in the same pass.
- **Tick the boxes** the slice closes in the trunk PR once its layer is merged.
- **A deviation caused by a missing rule** ("nothing told us to check that"): propose to the user to add the rule to this skill (`learnings.md` or the file concerned), separately, never mixed into the feature diff.

A design change is allowed only for correctness, privacy or security; a new feature is postponed and noted.

### 6. Commit and PR

UI slice: the user's go-ahead at step 4 is a prerequisite. Commit `feat: [<KEY>] <slice>`, then `pr-reviewer` and fixes before pushing.

Submit through the stack:
```bash
gh stack submit --auto --open      # --open: without it, --auto creates a draft that gh stack merge refuses
gh pr edit <n> --title "feat: [<KEY>] [n/N] <slice>" --body-file <body> \
  --add-label <labels> --add-assignee <assignee>
gh pr view <n> --json baseRefName,isDraft   # base = the previous layer, not the trunk; not draft
```
`--auto` sets no title, label, assignee or body: the `gh pr edit` right after applies the conventions. Body with the repo's template: the summary lists the criteria the slice closes, the testing part is the slice's `QA:` line.

Without the extension: `gh pr create --base <previous layer's branch> --label <labels> --assignee <assignee>`, body starting with `Stacked on #<parent>. Review after it.`

Updating a layer already pushed, in the stack model, is a restack, not a merge: `gh stack sync` then `gh stack push` (without the extension: `git rebase <base>` with `rebase.updateRefs`, then `git push --force-with-lease` on the chain). **Force-push rule: see the top of this file.**

Then `pr-ci-keeper` until green.

## C. Land

Reviews are human. The merge is mechanical, and that is where a stack breaks: merged out of order, or squashed without restacking what is above.

`gh stack merge` is atomic: every layer up to the chosen one, all or nothing. It refuses drafts; branch protection is never bypassed.

```bash
gh stack view                      # order, each layer approved, not draft
gh stack merge --squash --yes      # the whole stack into the trunk; --yes: no wizard
gh stack sync --prune              # local up to date, merged branches deleted
```

Landing a part is legitimate (`gh stack merge <PR number> --squash --yes`) when the first layers are approved and a later one is still in review; never to "unblock" a layer whose review found something.

Without the extension, one layer at a time, bottom up:
```bash
gh pr merge <bottom> --squash --delete-branch
git fetch origin
git rebase --onto origin/<trunk> <merged branch> <next layer>
git push --force-with-lease origin <next layer> <and every branch above>
gh pr view <next> --json baseRefName   # rewired onto the trunk
```

**Branches outside the stack**: before merging a layer, `gh pr list --base <branch>`; anything pointing at it without being part of the stack needs its own review, or waits.

**Close the trunk**:
1. Every box ticked, or struck through with a reason.
2. Last commit: `chore: [<KEY>] drop the slicing plan`.
3. Draft → ready, up to date with its base (merge, not rebase), CI green.
4. A single merge into the plan's base, which is not always the default branch. Never a feature trunk into the default branch when the base is an effort branch.

Done when: the trunk has one squashed commit per slice, no layer branch survives, every box is settled, the plan is gone from the trunk before it merges.
