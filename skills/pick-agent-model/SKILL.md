---
name: pick-agent-model
description: Choose the provider, model and effort for an agent a Cockpit master is about to launch, using the relevance matrix (`orchestrate matrix`), then rate the agent once its work is checked so the matrix learns. Use before every `orchestrate launch`, when relaunching an agent that failed or did poor work, when choosing a reviewer for another agent's work, and after checking an agent's report. Use it even when the right model seems obvious: picking from the matrix and rating the agent is what makes the matrix improve.
---

# Pick an agent's model from the matrix

The relevance matrix ranks provider × model × effort for each kind of task. It starts from estimates and gets better from the ratings masters give their agents. Your job: classify the task, take the right pick, state why, launch with `--kind`, and rate the agent afterwards.

## 1. Classify the task

Pick exactly one category, the one that best describes the **hardest part** of the task:

| Category | Pick it when the agent mainly… |
|---|---|
| `explore` | searches, maps code, finds files or call sites, without changing anything |
| `summarize` | reads a lot of text (ticket, logs, docs, diff) and condenses it |
| `implement` | writes new backend or general code from a clear spec |
| `frontend` | builds or changes UI: components, styles, UX behaviour |
| `tests` | writes or fixes tests for existing code |
| `refactor` | restructures code without changing its behaviour |
| `debug` | finds the cause of a bug that is not yet understood |
| `delicate` | changes risky code: auth, payments, migrations, concurrency, data loss |
| `architecture` | designs a structure or makes a choice that is costly to reverse |
| `review` | checks another agent's work or a diff |
| `large-context` | needs a very large amount of context at once (huge files, whole modules) |

Ties: `delicate` beats `implement`/`refactor`, `debug` beats `implement` when the cause is unknown, and `review` always means a review. If one task really falls into two categories, split it into two agents.

## 2. Read the row

Run `orchestrate matrix <category>`. Picks are ranked by the reference score blended with observed ratings, and unavailable providers come last. Run `orchestrate models` if you are not sure what is available.

**By default, take the first available pick.** Move away from it only for one of these reasons, and name the reason:

- **Second opinion**: a `review` of a Claude agent's work, or a competing variant, goes to another family (GPT via `--provider codex`) if it is available. Otherwise use another Claude model than the implementer's.
- **Budget or speed**: the task is small, mechanical or repetitive, so a cheaper or faster pick within 0.5 of the top score is enough.
- **Context size**: the material does not fit the top pick's context, so take the best pick that fits.
- **Retry**: the same pick already failed on this task, so go up one step (more effort first, then a stronger model).
- **Constraint**: GPT agents cannot launch sub-agents or load Claude skills. If the brief needs either, stay on Claude.
- **Few ratings**: a pick backed by fewer than 3 ratings is still an estimate. Don't let one bad rating rule out an otherwise strong pick.
- **Arène mode**: while `orchestrate calibration` says `Arène : active` for your orchestration, do not pick one model: the task goes to a `role-model-judge` competition (see the `orchestrate` skill). The rules below apply again once it is off.
- **Exploration**: about one launch in five, take the best pick flagged `à éprouver` (fewer than 3 ratings, score 4 or more) instead of the first pick, so new models such as Fable get rated. Only when all of these hold: the task is not urgent, the work is reversible, and an oracle or a reviewer will check it. Never explore on a sensitive or irreversible change, a retry, or when the user is waiting on the result. Announce it as `(exploration)` and rate it like any other agent.
- **Hors matrice**: a pick shown `hors matrice` is a combination other masters used and rated at least twice. It ranks like the others; if it keeps ranking first, propose adding it to the category.

Effort: apply section 2b, not the matrix's number blindly. Use the matrix's first pick as the starting point and check its effort against that grid; change it when size, risk, reversibility, oracle or time budget say so.

## 2b. Calibrate the effort

Effort is a cost: it multiplies time and tokens. The matrix gives a starting point; this grid decides. **Default `low` or `medium`. Every `high` needs a stated reason; `xhigh` and `max` are exceptional.**

| Effort | Use when |
|---|---|
| `low` | Mechanical, small or well-specified work (search, listing, rename, simple tests, config edit), a first-pass `review`, or an oracle will catch mistakes. |
| `medium` | **Default** for clear, low-risk work (implement, frontend, tests, refactor, review, summarize) with an existing pattern and an oracle. A sensitive or hard-to-reverse change is never `medium`, even with a clear spec. |
| `high` | At least one of: change that is sensitive or hard to reverse (auth, data, migration, public API); deep reasoning with no oracle (unknown-cause debug, architecture choice); a retry after a `medium` failure. |
| `xhigh` / `max` | Only irreversible production changes or a second failed attempt at `high`, and only with the master's one-line justification. |

Five inputs set the level. Apply risk and reversibility first: sensitive or hard-to-reverse work is at least `high`, and an oracle never lowers it below that floor. For the rest, start at `medium` and move:
1. **Size and nature**: tiny or mechanical → down; long chain of dependent decisions → up.
2. **Risk**: wrong output is cosmetic → down; touches data, money, access → up.
3. **Reversibility**: a git revert undoes it → down; deployed, migrated or sent → up.
4. **Oracle**: tests, type-check, or an independent reviewer will check it → down one step (verification replaces thinking); nothing will check it → up one step.
5. **Time budget**: see below; when the budget is tight, lower effort before dropping verification.

**Time budget per agent task** (wall clock, state it in the brief; a sub-orchestrator gets its own whole-sub-task budget instead): explore 5 min, summarize 5 min, tests 10 min, implement/frontend 15 min, refactor 20 min, debug 20 min, review 10 min, architecture 15 min. An agent that exceeds twice its budget is checked with `orchestrate read`: if it is looping, stop it and relaunch narrower rather than waiting. Total run of 3 h means the plan was too big or the effort too high.

**Review passes** (measured 2026-11-06 on one review of a permissions diff against known ground truth: `sonnet·low` alone 45% of the defects in 65 s; low pairs, mixed families or not, 45-50%; `sonnet·high` 59% in 171 s; `opus·high` all of them in 15 min, and alone in checking the external binary). So: a pair of lows does **not** beat one high, and mixing families at low effort adds nothing. Do:
1. First pass `sonnet·low` (best yield per minute: it catches defects readable in the code, such as a missing validation or a wrong sequence).
2. Add a targeted `high` pass only when the diff touches permissions, concurrency/timing or an external tool's behavior; use `opus·high` when the answer must be checked in the tool itself.
3. Treat any "no problem" from a low reviewer as unverified: re-check that point yourself or with the `high` pass. A second low agent or a weaker model (haiku) as a double check adds little.
Do not pair agents for `implement`, `refactor` or `architecture`: two writers conflict and one reasoner is needed.


## 3. Announce and launch

Before launching, write one line the user will see in the tree:

```
w4 · implement → claude sonnet / high (1er choix, 4,3/5 sur 7 notes)
w5 · review → codex gpt-… / medium (2e avis sur le travail de w4)
w6 · architecture → claude fable / medium (exploration, 0 note)
```

Then launch with `--kind <category>`, plus the provider, model and effort you chose. Without `--kind` the rating goes nowhere.

## 4. Rate after checking

Once you have read the report and checked the work (diff, tests, review), rate it:

`orchestrate rate <id> <1-5> "<one sentence on what went well or wrong>"`

| Score | Meaning |
|---|---|
| 5 | Usable as is, nothing to fix |
| 4 | Minor touch-ups made by you or one short `send` |
| 3 | Usable after real corrections |
| 2 | Mostly wrong, partially reused |
| 1 | Discarded or redone by another agent |

Rate the model's work, not how hard the task was or how good the brief was. If the brief was the problem, say so in the note and rate no lower than 3. Rate every agent you integrate or discard, including agents you stop early.

## On failure

When an agent's work gets a 2 or less: rate it first, then relaunch per the "Retry" rule (same category, one step up), with a brief that says what went wrong the first time.
