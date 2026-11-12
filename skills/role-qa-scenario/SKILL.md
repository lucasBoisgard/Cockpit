---
name: role-qa-scenario
description: Write a short standalone QA plan for a change (company, tabs or screens, what to look at, expected results), without running it. Use when the user asks "give me a QA scenario/plan", "brief me for QA", "company, tabs, what to check" after a PR, a fix or a local run. Execution happens only after the master obtains explicit P3 consent.
---

# QA scenario

You write the plan a human (or a later QA run) will follow; you do not run it. Load `agent-protocol` first and read `learnings.md` next to this file.

## Contract
- **Trigger**: a diff, PR or ticket plus a request for a QA plan, scenario or briefing.
- **Inputs** (the brief gives them): ticket or PR, snapshot (`base`/`head`), business brief if one exists, local data hints (company, flags, seeded data), the scope to cover.
- **Output**: `qa-scenario-r<k>.md` in the run dir (also pasted short in the report), then the report per `agent-protocol`.
- **Domain skills**: the repo's own QA skill when it has one (for example a `qa-*` skill in its `.claude/skills/`: assertions, environment) and `run-app` (stack up or not), both read-only; `review-context` when the ticket is missing.
- **Launches**: nothing.
- **Kind / model**: `plan` (a kind, not `--mode plan`: you write your own file). Effort per `pick-agent-model` §2b; default `sonnet`, effort `low`; `medium` only if the change spans several apps.
- **Bound**: 1 pass per snapshot, 1 revision per remark from the user.
- **Forbidden**: H1, H2, H13. Also: run the scenario, open the browser, start or restart the app, touch data, claim a result nobody observed.

## Steps
1. **Read the change**: ticket, PR description, `git diff <base> <head> --stat`, then only the files that decide behaviour. Facts get `[SEEN file:line]` or `[DEDUCED]`.
2. **Take the assertions** from the business brief; without one, derive them from ticket + PR description and write "derived" in the plan (same rule as `qa-running-app`).
3. **Check feasibility** against the `qa-running-app` conditions (behavioural diff, main checkout, stack up) and the ladder rung each check needs. State which conditions hold or are unknown; never start the stack to find out.
4. **Write the plan**, one block per scenario, at most 6 and 1 line per field:
   - **Setup**: company, user or role, flag state, data needed (UUIDs, never names or emails, H13).
   - **Where**: app, tab or screen, route.
   - **Do**: the minimal actions.
   - **Look at**: what to watch (UI, network call, mail, DB state).
   - **Expected**: the observable result, and the wrong result that means a bug.
5. **Add a "not covered" line**: what the plan cannot show (no mail transport locally, prod-only data, other tenants).
6. **Execution**: write "not run". Running it needs explicit P3 consent from the master, then `qa-running-app` owns the run and its report.

## Output file
Head with the snapshot line, then: verdict line (`n scenarios, assertions: brief | derived, feasible: yes | no | unknown`), the scenarios, the not-covered line. Short enough to read in one screen (H8).

## Done when
Every assertion maps to at least one scenario with an expected result, nothing was executed, and feasibility is stated. Report `TERMINÉ`.

## Escalate
- `BLOQUÉ`: no diff, ticket or brief to derive assertions from, or the business rule is missing. Give options and a recommendation.
- The user asks to run it: say P3 consent is the master's call, do not start.
