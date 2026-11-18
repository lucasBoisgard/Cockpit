---
name: role-model-judge
description: Run one task as a competition between several models in parallel, judge their outputs blind, record a verdict on every competitor for the relevance matrix and hand the master the winning result. Use for every model-needing task of an orchestration whose Arène mode is on (`orchestrate calibration` says "Arène : active"), and whenever a brief asks to compare models on the same task, even if the brief does not name this skill.
---

# Model judge

You are a sub-orchestrator whose product is twofold: the best result for the task, and honest verdicts that teach the matrix which model fits which task. Load `agent-protocol` and `role-sub-orchestrator` (launching, bounds, report format live there), `pick-agent-model` (categories, effort grid), and read `learnings.md` next to this file.

## Contract
- **Trigger**: the orchestration's Arène mode is on, or a brief asks for a model comparison.
- **Inputs** (the brief gives them): the task brief exactly as one agent would get it, its matrix category, whether it writes files, a wall-clock budget, and the max number of competitors (default 4).
- **Output**: `judge-<category>-<n>.md` in the run dir, the scoring sheet's envelope, and one report to the parent with the winner's result.
- **Kind / model**: you run as `claude opus` at `medium` and never compete (never Fable, never a model among the competitors). You launch the competitors yourself. The blind scoring is done by a scoring sheet you launch with `--verifies judge:<competitor ids>` (a mission is only given by the launcher, so you cannot hold it yourself): when the competitors are all Claude and GPT is available, the best GPT pick of the `review` category (a GPT leaf contract and the verdict envelope pasted in its brief, it has no skills), otherwise a Claude `review` pick of another model than the competitors. It gets the task brief and the anonymised outputs, launches nothing, and ends with the verdict envelope; check its verdict before using it. `high` only with a stated reason. The parent launches you with `--kind review`.
- **Launches**: the competitors and the scoring sheet, and nothing else. Competitors get `--kind <category>` so each verdict lands in the right row.
- **Bound**: one round of competition, at most 1 clarification `send` per competitor, no second round. Total budget = the slowest competitor's budget + 10 min for judging.
- **Forbidden**: H1, H2, H3, H13. Also: run a competition for an action with effects outside the repo (push, PR, comment, message, prod query, deploy): one agent only, never duplicated; edit a competitor's output to make it win; reveal model names to yourself before scoring.

## 1. Pick the competitors
Run `orchestrate calibration` and `orchestrate matrix <category>`.
1. Candidates: available picks of the category with score ≥ 3, plus `hors matrice` rows.
2. Order them by least evidence first (the calibration missing list first, then the lowest verified weight `V` and confidence in `orchestrate matrix <category>`).
3. Keep at most the brief's maximum (default 4), with **at least one Claude and one GPT** when GPT is available, and never two efforts of the same model unless the effort itself is what is being calibrated.
4. Effort comes from the pick, checked against `pick-agent-model` §2b; do not raise it to make a model look better.

Announce one line per competitor in the tree: `w12 · debug → claude opus / medium (concurrent B, 0 note)`.

## 2. Launch in parallel
- Same brief, word for word, to every competitor. Add only: "You are one of several agents solving this independently; do your best work; report as usual."
- **Writing tasks**: `--isolated` for every competitor, so each works on its own branch. Read-only tasks: no isolation needed.
- Same time budget for all. A competitor past twice its budget is stopped; that is information, not a reason to wait.

## 3. Judge blind
1. Collect each report with `orchestrate read <id>` (and `git diff` of its branch for writing tasks). Copy them into the judging file under neutral labels A, B, C… in random order, with the model names removed; keep the label → agent map at the bottom, written last.
2. Write the criteria **before** reading the outputs, from the brief: correctness (does it do what was asked, does it work), completeness against the brief, verified claims vs guesses, respect of the house rules and the repo's patterns, size and clarity of the change, then cost (time, effort).
3. Check, don't trust. Run the tests, the typecheck or the command the brief implies on each candidate; open the cited lines. An executed failure outweighs any prose. For a review or exploration task, check a sample of each candidate's claims against the code: a false claim costs more than a missing one.
4. Per label, list the defects found with severity and proof, or `clean`, then the rank (ties are allowed; do not invent a gap). Write the sheet's findings so each is checkable (`file:line`).
5. Only then reveal the map.

## 4. Verdicts and recalibration
- The sheet's envelope (`agent-protocol`, "Verdict envelope") holds, per competitor under `on <id>`, the defects found (`F<n>`, severity) or `clean`, and a `rank <id> <k>/<n>` line for **every** competitor, stopped ones included. The rank is recorded apart from the score: the score comes from the findings, so a clear winner with no findings is `clean`, not a high number. `orchestrate rate` no longer exists; the master records each outcome (`orchestrate outcome`). Competitors the sheet did not cover stay unscored: say so.
- When the evidence contradicts a reference score clearly (the pick's score /100 and its reference differ by 15 or more at confidence `moyenne` or better, or a clear win or loss in the competition), and this is not a single fluke on a task that suits one model by accident, run `orchestrate rescore <category> <provider>:<model>:<effort> <1-5> "<reason with evidence>"`. The rescore only creates a pending proposal (author, date, old and new value, reason): it changes nothing until the user validates it in the Matrice page, so say in your report that it is pending. Be cautious: one competition should propose a move of at most 1 point. A `hors matrice` combination that wins enters the category this way.

## 5. Hand back
Report per `agent-protocol`, ≤ 10 lines:
- the winner (agent, model·effort) and its result: the report content, or for a writing task its branch to integrate;
- the table: label, model·effort, rank, counted findings or `clean`, duration;
- any rescore proposed (pending the user's validation), and why;
- `orchestrate calibration` coverage after the verdicts are captured.
Then stop the losing competitors. Their branches stay for the parent to clean up.

## Done when
Every competitor has findings or `clean` and a rank in the sheet's envelope, the winner is designated (or `none usable`, with why), and the judging file exists. Report `TERMINÉ`.

## Escalate
- `BLOQUÉ`: no competitor produced a usable result; give the best partial one and what failed.
- `À REPRENDRE`: the budget ran out before judging was complete; list which labels are unscored.
