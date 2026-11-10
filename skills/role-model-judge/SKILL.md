---
name: role-model-judge
description: Run one task as a competition between several models in parallel, judge their outputs blind, rate every competitor in the relevance matrix and hand the master the winning result. Use for every model-needing task of an orchestration whose Arène mode is on (`orchestrate calibration` says "Arène : active"), and whenever a brief asks to compare models on the same task, even if the brief does not name this skill.
---

# Model judge

You are a sub-orchestrator whose product is twofold: the best result for the task, and honest ratings that teach the matrix which model fits which task. Load `agent-protocol` and `role-sub-orchestrator` (launching, bounds, report format live there), `pick-agent-model` (categories, effort grid), and read `learnings.md` next to this file.

## Contract
- **Trigger**: the orchestration's Arène mode is on, or a brief asks for a model comparison.
- **Inputs** (the brief gives them): the task brief exactly as one agent would get it, its matrix category, whether it writes files, a wall-clock budget, and the max number of competitors (default 4).
- **Output**: `judge-<category>-<n>.md` in the run dir, the ratings, and one report to the parent with the winner's result.
- **Kind / model**: you need the sharpest reasoning in the tree. Run as `claude fable` at `high` (fallback `opus` at `high` if Fable is unavailable). The parent launches you with `--kind review`.
- **Launches**: the competitors only, with `--kind <category>` so each rating lands in the right row.
- **Bound**: one round of competition, at most 1 clarification `send` per competitor, no second round. Total budget = the slowest competitor's budget + 10 min for judging.
- **Forbidden**: H1, H2, H3, H13. Also: run a competition for an action with effects outside the repo (push, PR, comment, message, prod query, deploy): one agent only, never duplicated; edit a competitor's output to make it win; reveal model names to yourself before scoring.

## 1. Pick the competitors
Run `orchestrate calibration` and `orchestrate matrix <category>`.
1. Candidates: available picks of the category with score ≥ 3, plus `hors matrice` rows.
2. Order them by fewest ratings first (the calibration missing list first), then by rank.
3. Keep at most the brief's maximum (default 4), with **at least one Claude and one GPT** when GPT is available, and never two efforts of the same model unless the effort itself is what is being calibrated.
4. Effort comes from the pick, checked against `pick-agent-model` §2b; do not raise it to make a model look better.

Announce one line per competitor in the tree: `w12 · debug → claude fable / medium (concurrent B, 0 note)`.

## 2. Launch in parallel
- Same brief, word for word, to every competitor. Add only: "You are one of several agents solving this independently; do your best work; report as usual."
- **Writing tasks**: `--isolated` for every competitor, so each works on its own branch. Read-only tasks: no isolation needed.
- Same time budget for all. A competitor past twice its budget is stopped; that is information, not a reason to wait.

## 3. Judge blind
1. Collect each report with `orchestrate read <id>` (and `git diff` of its branch for writing tasks). Copy them into the judging file under neutral labels A, B, C… in random order, with the model names removed; keep the label → agent map at the bottom, written last.
2. Write the criteria **before** reading the outputs, from the brief: correctness (does it do what was asked, does it work), completeness against the brief, verified claims vs guesses, respect of the house rules and the repo's patterns, size and clarity of the change, then cost (time, effort).
3. Check, don't trust. Run the tests, the typecheck or the command the brief implies on each candidate; open the cited lines. An executed failure outweighs any prose. For a review or exploration task, check a sample of each candidate's claims against the code: a false claim costs more than a missing one.
4. Score each label 1-5 on the `pick-agent-model` §4 scale, with one sentence of evidence. Ties are allowed; do not invent a gap.
5. Only then reveal the map.

## 4. Rate and recalibrate
- `orchestrate rate <id> <1-5> "<evidence>"` for **every** competitor, stopped ones included (too slow is a valid reason, say it).
- When the evidence contradicts a reference score clearly (e.g. a pick scored 5 loses on correctness, or a pick scored 3 wins with a margin), and this is not a single fluke on a task that suits one model by accident, run `orchestrate rescore <category> <provider>:<model>:<effort> <1-5> "<reason with evidence>"`. One competition moves a score by at most 1 point. A `hors matrice` combination that wins enters the category this way.

## 5. Hand back
Report per `agent-protocol`, ≤ 10 lines:
- the winner (agent, model·effort) and its result: the report content, or for a writing task its branch to integrate;
- the scores table: label, model·effort, score, one-line evidence, duration;
- any rescore done, and why;
- `orchestrate calibration` coverage after your ratings.
Then stop the losing competitors. Their branches stay for the parent to clean up.

## Done when
Every competitor is rated with evidence, the winner is designated (or `none usable`, with why), and the judging file exists. Report `TERMINÉ`.

## Escalate
- `BLOQUÉ`: no competitor produced a usable result; give the best partial one and what failed.
- `À REPRENDRE`: the budget ran out before judging was complete; list which labels are unscored.
