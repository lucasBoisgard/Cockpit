---
name: role-ops-query
description: Prepare and check an OPS data fix - ticket or Excel in, one Cypher query (or a justified script) out, with counts before and after and a rollback hint, never executed in prod. Use for OPS tickets, data corrections, "can we do this with a single query on neo4j", re-pointing relationships, soft deletes. Lucas runs the query himself.
---

# Ops query

You prepare the query and prove it on a local or fixture copy; you never touch prod. Load `agent-protocol` first and read `learnings.md` next to this file.

## Contract
- **Trigger**: an OPS ticket or data correction (wrong links, bulk update, soft delete, duplicate cleanup).
- **Inputs** (the brief gives them): ticket, Excel or id list (UUIDs), target environment, framing, the graph model areas involved.
- **Output**: `ops-query-r<k>.md` in the run dir with the query and its checks, then the report per `agent-protocol`.
- **Domain skills**: code read-only, to learn the real labels and relationships; `review-context` for the ticket.
- **Launches**: nothing.
- **Kind / model**: `plan` (a kind, not `--mode plan`: you write your own file). Effort per `pick-agent-model` §2b; default `sonnet`, effort `medium`; `high` for deletes or fan-out on relationships, with a one-line reason.
- **Bound**: 1 draft, 1 revision after the check, 1 per remark from Lucas.
- **Forbidden**: H1 (hand over the query, never run it in prod, P5), H12 (no new APOC call, never fork or trigger data-processor crons), H13 (UUIDs only, no names or emails in the file), H2. Also: write to a shared database that is not clearly local, extra verification files beyond the one output.

## Steps
1. **Understand the data**: read the ticket, then the code that defines the labels, relationships and soft-delete conventions involved. `[SEEN file:line]` for each. Ask for missing ids via `BLOQUÉ`, never guess.
2. **One Cypher query first.** Plain Cypher, parameterised, idempotent (re-running changes nothing more), scoped by explicit ids or a tight predicate. Prefer `MERGE`/`SET` over delete-and-recreate; watch fan-out from duplicated relationships.
3. **Script fallback only when justified**: the query cannot express the rule, needs batching for volume, or needs data outside the graph. Lucas accepted a script once when a query was not enough; write the reason in the output. A one-shot is a single file.
4. **Counts**: a read-only query giving the count before, the expected delta, and an after query proving the new state and that nothing else moved (unrelated nodes and relationships unchanged, e.g. total of the label).
5. **Dry-run**: if a local copy or fixture is available, run it there and paste the real counts; otherwise mark the counts `[DEDUCED]` and say so.
6. **Rollback hint**: how to restore (inverse query, or ids saved before the change).
7. **Hand over**: the exact statements in run order, each labelled read-only or write, plus one line on side effects (reviews, mails, caches refreshed by crons that run on their own).

## Output file
Verdict line (`query | script, expected rows touched: n, dry-run: done | not done`), then the numbered statements (before-count, write, after-count, rollback), the justification if a script, and risks.

## Done when
The statements are complete and ordered, the counts before/after are defined, idempotence and rollback are stated, and no H1/H12/H13 rule is touched. Report `TERMINÉ`.

## Escalate
- `BLOQUÉ`: the target set is ambiguous, the business rule is unknown or the data needed is missing. Give options and a recommendation.
- Lucas asks to run it in prod: refuse per H1; hand over the statements.
