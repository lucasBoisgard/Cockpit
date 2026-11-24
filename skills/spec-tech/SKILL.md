---
name: spec-tech
description: From a ticket to a merged trunk - a tech spec written after a deep code analysis (settled decisions, as few open questions as possible, each one explored), a split into stacked PRs, a "Tech spec" section for the ticket plus a dev plan, publishing the trunk, then building slice by slice (TDD, verification, PRs in a gh stack) and landing the stack. Use when the user asks for « spec tech », « fais la spec de <ticket> », « découpe ce ticket », « publie le plan », « implémente le plan / la slice n », « merge la stack », a tech spec or slicing plan for a ticket, or after a refinement to fold the answers back in. To re-split a stack coded outside this flow or size-check a single PR, use role-slicer.
---

# Spec tech

A ticket with its functional spec comes in; a merged trunk comes out. Four phases, each one stops and waits for the user before the next:

1. **Specify**: code analysis, decisions, split, ticket section + dev plan. This file.
2. **Publish**: trunk + draft PR for the plan review. This file.
3. **Build**: one slice after another (or in parallel), TDD, verification, PR in the stack. → `build.md`.
4. **Land**: merge the stack into the trunk, then the trunk into its base. → `build.md`.

Read `learnings.md` next to this file before starting. Read the house rules (`~/.claude/house-rules.md`, then `~/.claude/house-rules.local.md`): they give the machine's conventions for this skill (ticket tracker, ticket key, branch prefix, language and headings of the ticket section, where the data and code live, PR form). A convention they do not give: ask the user once and record it in the plan's `## Conventions`. In a Cockpit master session, every agent (exploration, review, slice) is launched with `orchestrate launch`, not the Agent tool.

**The spec is clear and settled.** The ticket goes to refinement with as few open questions as possible, each one already explored so it can be settled in a minute. Nothing is built before the team has reviewed the plan: building first turns the review into a rubber stamp.

## What the Specify phase delivers

1. **The ticket's "💻 Tech spec" section**, in the team's language (house rules), in business words. What the team reads in refinement.
2. **The dev plan**, in English (it is committed on the trunk): `.scratch/<KEY>-slices.md`, where `<KEY>` is the ticket key. The living source of truth for the whole build.

Both move together, in the same pass.

**A single PR** (most bugs, copy, config): no trunk, no stack, no plan file, no numbered "Split". The ticket section is enough; scope, callers and criteria go in the body of the single PR. Say it plainly and skip the Publish phase.

## 1. Read the whole ticket context

If `.scratch/<KEY>-slices.md` already exists, read it and start from there: do not re-split. No ticket key → ask.

- Ticket and comments, through the tracker's MCP server (e.g. Atlassian `getJiraIssue`) or its CLI (e.g. `acli jira workitem view <KEY> --json`, plus `--fields summary,comment --json` for QA comments). Neither works → ask the user to sign in (e.g. `acli jira auth login`) and stop, no blind retry. The tracker is read-only here, except the Tech spec section when the user asks for it (Publish phase). The plan paraphrases the ticket, it never copies it.
- The epic and sibling tickets (epic, "relates to", "blocks"), with their Tech spec section if it exists: what is already decided, prerequisites on the base branch, what belongs to another ticket. When the boundary is unclear, ask before including.
- Mockups: each Figma link becomes fileKey + node-id in `## Design`, next to the criterion it illustrates. Resolve the component set, not only the frame (the repo's design-integration guidance when it has one): hover, empty and selected are the states a link does not show. A claude.ai design prototype is not readable: say so.
- Bug: the linked chat thread (bug channel) often holds the decisive detail.
- Team conventions, to note in the plan: branch prefix, base (the default branch, or the long-lived branch of the effort when the ticket belongs to one; ask if the epic hints at a wider rework: getting it wrong re-bases the whole stack later), PR labels and assignee (`pr` in the cockpit config when set, otherwise the house rules, H10), the repo's ticket-process doc if any.

Output: the numbered list of criteria (paraphrased in one line), the design links. Everything the ticket asks for is in scope: no "Out of scope" section. What a sibling ticket owns is noted in one line "→ <KEY>" in the slice concerned.

## 2. Analyse the code in depth

Launch `Explore` agents in parallel ("very thorough"), each with one precise question:
- **Data and back end**: where the data lives (which stores), legacy or new architecture, entities, queries, commands, ports, authorizers, existing routes.
- **Front end**: screens and components, design-system or legacy, where the data comes from.
- **Census**: prefer the highest existing seam. For every shared element you plan to change (state shape, entity, port, bridge type, API contract, route, state machine, link builder, component, query builder), every caller and what each one does today. An element with N callers is N behaviours you answer for. This census becomes the `Surfaces` line of each slice: the reviewer's and QA's non-regression list.

Then read the key files yourself: `Explore` locates, it does not audit. Every claim in the plan carries a `file:line` you saw. Before writing "X does not exist", run the search again yourself, without `| head`, wider, with two other plausible names.

For a back-end slice, first read the repo's architecture skills and guidelines (layers, commands and queries, repositories): they decide the shape (e.g. one command or query per entry point, a command returns nothing, a query returns a DTO, tenancy handled where the repo handles it, lock, read route). The scope names its artefacts (command/query, port, adapter, domain object, route, bridge type), it does not describe a behaviour.

## 3. Settle

A **fact** is looked up in the code, never asked. Only real **decisions** go to someone.

For each fork (where to store the data, reuse or create, sync or async, legacy or new architecture…): the real options, then **settle it**. By default everything is a **decision**: the choice and why in one sentence. The user validates the tech decisions.

A fork becomes an **open question** (OQn) only if it cannot be settled without someone else:
- visible behaviour not described or ambiguous (re-reading a sentence of the ticket: where the control is, when it is disabled, what it says) → **PM**;
- tracking, data → **PO**;
- a choice that commits beyond the ticket (architecture, duplicated data, another team) → **Team**.

Before leaving it open, **run an exploration**: one `general-purpose` agent per question, in parallel, with the exact question. It looks at how the same case is handled elsewhere in the product, what the epic, sibling tickets and validated specs say, the git history and PRs of the code concerned, the cost and consequence of each option. A precedent found = a decision, the question closes. Otherwise it goes out with its exploration summarised (what we know, options and costs, recommendation, what it blocks).

A PM or PO question is never settled by the user nor by you; never write a decision in the past tense with a name on it if its owner has not answered. The ticket is the reference: what the functional spec states explicitly is never a question, even if a workshop or your opinion differs (a precise scenario beats a general rule). Aim for zero open questions; beyond two, ask yourself what you did not explore. If the ticket, the mockup, the code or an exploration gives the answer, or if your recommendation rests on a fact and not on taste, it is not a question: it is a decision, with its source. No useless data in the spec: no context reminder, no detail of a resolved exploration.

**Mockup against ticket**: on behaviour (what exists, for whom, under which condition), the ticket wins, and it is a recorded decision so nobody "fixes" the UI towards the mockup. On appearance (position, label, case, spacing), the mockup wins and the plan names the component or token. Two frames that contradict each other are often two states of the same element. Every mockup/ticket gap has the PM as owner in its `Status`, even when the ticket wins.

**To check on every slice**:
- The thinnest version that still works; no hidden dependency on a later slice; edge cases covered and what is deliberately postponed, named.
- Data scope: per user, per company or tenant, safe under impersonation.
- Authorization: who, which authorizer, multi-tenant and impersonation cases, checked again on download or write.
- Migration: compatible with the current release (the stack lands over several days); a non-trivial backfill is a slice of its own.
- Idempotence and failure: retry, double click, partial failure, "at least once" in async.
- API contract: a bridge type that changes shape breaks its readers, to list like a UI caller.
- Reuse or create: name the command, query, entity, port or authorizer you extend; "new file" needs a reason.
- Overlay (modal, panel, popover): the page under it stays mounted, the state is an added key (e.g. `detailSlug`), never a replacement of the view. Closings the ticket asks for and closings we add (cross, click outside, Escape, back): two separate lists. Does it open above another modal, and from which system?
- Components: for each design-system component named, source and stories read, the slots carry the layout; otherwise it is a decision now, not a workaround found in review.

## 4. Split

- **Vertical slices**: each slice works end to end (the first is the walking skeleton) and ships to production alone (flag, trunk or invisible: name the mechanism).
- **One decision per slice**, not one criterion per slice. Never ship in slice n a rule that slice n+1 contradicts: merge them.
- **≤ ~400 lines of production code** per slice, tests not counted. The estimate is the sum of the named artefacts, made once the layer is fixed (legacy or new architecture changes the figure by a factor) and redone after the caller census: what they cost is in the slice or makes a slice of its own. Observed order of magnitude, not a rate: query ~60, port + adapter ~50, route + bridge ~40. Too big → cut again by case, by screen or by layer. The check works both ways: merge two slices that are one decision if it fits under 400. A slice that cannot be cut under 400 is flagged with its reason.
- **Linear chain** 1 → 2 → 3: each slice sits on the previous one. A slice directly on the trunk only if it is truly independent: two slices touching the same element on two parallel bases is a postponed conflict.
- **Gate**: integration trunk (default: the stack lands in the trunk, one single merge into the base) or feature flag (each slice ships off, a last one turns it on). The trunk is the only branch targeting the base, and it is never slice 1: a branch acting both as trunk and slice accumulates every slice and can no longer be reviewed. On an effort base, a scratch-file guard check protects nothing: removing the plan in the last commit is the only safeguard.
- **One trunk per ticket, kept apart**: never a trunk shared between tickets, never a PR of one ticket stacked on a PR of another; PRs are numbered 1..N within their ticket. If the prerequisite ticket is not on the base branch yet, the trunk starts from its trunk and is retargeted to the base once it is merged (merge, never rebase).
- **QA per criterion, not per slice**: back-end or invisible slice → "no QA (tested)"; UI slice → the criteria to check; last slice → full acceptance pass. The coverage doubles as the QA checklist.
- A UI slice without a `Design` line (frame, or "no mockup") cannot be planned. It names each design-system component with its slots and size/appearance props, and the separators (divider, spacing tokens); an element with no design-system component is flagged, not invented.

## 5. Review yourself before showing

Cross pass first: two slices that decide the same thing → merge; a slice that is a sibling ticket's work → removed now.

Then an independent `general-purpose` agent, with the ticket and the plan, without your reasoning. It checks that the files and callers cited exist and do what you say, that each criterion is covered, that each coverage line has a source (`AC` ticket, `plan` decision, `regression` caller from the census) — a line without a source is invented, delete it —, and that the estimates hold. Fix what it confirms. Read the ticket one last time against the `AC` lines.

## 6. Report to the user

1. The ticket section, ready to paste.
2. The tech decisions, as one list: the user validates them in a block ("ok except D3: …").
3. The remaining open questions with their exploration: the user may close one if they have the information, not answer in place of the PM or the PO.
4. The path of the plan.

Nothing is written in the tracker or on GitHub without an explicit request: a request in this skill allows writing the Tech spec section and creating or editing PRs, never posting comments (H1). This phase creates no branch: its result can be thrown away and redone.

## 7. Publish (when the user asks)

- **Ticket**: read the description again just before, insert or replace only the "💻 Tech spec" section, at the place the house rules give (default: just before the acceptance criteria).
- **Trunk**:
  ```bash
  git switch -c <prefix>/<KEY> <base>
  git add -f .scratch/<KEY>-slices.md
  git commit -m "chore: [<KEY>] slicing plan"
  git push -u origin <prefix>/<KEY>
  gh pr create --draft --base <base> --label <labels> --assignee <assignee> \
    --title "feat: [<KEY>] <feature> (trunk)" --body-file <body>
  ```
  Body in English, in this order: a one-line summary of the feature, *Decisions needing your call* (open questions and decisions taken by the dev alone, one line each with who must answer), the ticket link, then the coverage as a checklist, one box per line (`- [ ] (AC) … — slice 2`). Without boxes, the trunk has no living scope. The PR stays draft for the whole build. A decision is born in the plan and then copied into the PR, never the other way: a decision that exists only in a PR body is invisible to the slice that implements it.
  If the repo has a check that refuses `.scratch` files on the default branch, it is expected red on a trunk whose base is the default branch: the plan is removed in the last commit before the trunk merges. Do not "fix" the workflow.
  Put the trunk link in the ticket section.
- **Then stop.** Ask the team: is the split right, is anything misplaced, is a coverage line missing. Feedback arrives as commits on the trunk before cutting the stack. Building before the review is possible only if the user chooses it knowing the cost: re-splitting after slice 3 means re-basing everything above.

## 8. After the refinement

The user reports what was said, or the answers are in the ticket ("→ yes"). Each settled question becomes a dated decision, cleaned up in the ticket section (no answer left loose inside the question). Adjust the split, update the ticket section, the plan and the trunk checklist together, record the changes in `Deviations log`.

## Ticket section format

Short sentences, business words, no file names. One line per idea. Written in the team's language with the headings the house rules give; otherwise the template below, as is.

```
### 💻 Tech spec

* Trunk PR: <link> (line absent until the trunk exists)
* Split: N PRs.
  1. <Business title> (~X lines): <what the user or the system gains>.
     * <new or changed command/query, real name>
  2. …
* Tech decisions:
  * <What is new, stated positively, in one short line and in business words (e.g. the tech definition of a new state).> Nothing about what does not change. No why unless it prevents a misreading. Complement only: nothing the ticket or the Split already says (PRs, command/query); section absent if nothing is left. No decision that has only one possible option or belongs to implementation (files, locks, tests, lines).
* Parallelisation and order:
  * Starts when <KEY: what> is on the base branch. Section absent if it says nothing (no prerequisite, "can run in parallel with…").
* Open questions (to settle in refinement):
  * OQ1 (PM): <closed question, A or B>.
    * What we know: <precedent in the product, what the epic says, in one or two sentences>.
    * A: <consequence, cost>. B: <consequence, cost>.
    * Recommendation: A. Blocks: PR n.
```

No open question → no section. Every open question of the plan is here, without exception.

## Plan format (English)

```
# <KEY> — slicing plan
<one-line summary>

## Open questions
| # | Question | Owner (Team / PM / PO) | Blocks | Recommendation |

### OQ1 — exploration
- Known: <precedents with `file:line`, sibling tickets, git history>
- Options: A <cost, consequence> · B <cost, consequence>
- Recommendation: <A, why>

## Conventions
- Branch prefix: <prefix>/ → trunk: <prefix>/<KEY>
- Base branch: <default branch | effort branch> — prerequisites: <KEY on base>
- PR labels / assignee: <cockpit config `pr`, else house rules>
- Ticket-process doc: <path | none>

## Gate
<integration trunk, slices as a gh stack rooted on it | feature flag <name>>

## Seams
- <area>: `file:line` — what it does today.

## Design
<Figma fileKey / node-id — what it covers | proto not readable | none>

## Slices
**Stack order = slice numbers: 1 → N.**

### 1. <title>
- Branch: <prefix>/<KEY>-<desc> (base: trunk | slice n-1's branch)
- Scope: <named artefacts>
- Depends on: <none | slices>
- Est. lines: ~N (<per artefact>)
- Ships by: <stacks into trunk | feature flag | dark launch | fully live>
- Reviewer checks: <the one thing this PR is about>
- Surfaces: <every caller of what changes — which change, which stay identical, the action each keeps; n/a only if nothing shared>
- Design: <frame | none>
- UI (design system): <component + slots + size/appearance per element, separators; flag anything with no component>
- QA: <no QA needed (tested + reviewed) | ACs to verify | full acceptance pass>
- Advances: <criteria>

## Coverage
| Criterion (paraphrased) | Source (AC / plan / regression) | Slice(s) |

## Decisions
- **D1 — <choice>.** *Question:* … *Choice:* … Status: <settled YYYY-MM-DD by the user | open → Team·PM·PO (OQn) | settled in refinement YYYY-MM-DD>. Why: …

## Handover to sibling tickets
- <KEY>: <what we leave or ask them>

## Deviations log
| Date | Slice | Change | Why |
```

## Learnings

When the user corrects a spec or a build (tone, format, a misclassified decision, an omission), add a dated line to `learnings.md`: what happened, the rule to keep. Rules tied to one company or repo go to `~/.claude/house-rules.local.md` instead.
