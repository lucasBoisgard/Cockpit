# Topologies played by a sub-orchestrator

Roles are named by skill: `role-framer`, `role-challenger`, `pr-reviewer`, `pr-ci-keeper`; implementer, writer, explorer have no skill yet (paste their sheet). Grants come from the user's words, copied from the brief. Challenger family differs from the author's, effort `medium`.

## T1 Deliver a slice (kind implement; budget ~60 min; 2 leaves at once)
1. Implementer (`sonnet·medium`; high for business invariants) → `impl-r1.md`, snapshot, size. Over 1000 lines: `BLOQUÉ` (master redispatches to the slicer).
2. `pr-reviewer` (`sonnet·low`, high targeted on risk) → CANDIDATEEs; you assign ids.
3. `role-challenger` → statuses. Loop: resume implementer on CONFIRMED → new snapshot → delta review → challenger. Max 3 cycles.
4. Writer: PR description.
5. Grants `commit`/`push`/`pr` missing → `BLOQUÉ` P2. Else `pr-ci-keeper` alone in the worktree: commit by announced groups, content fingerprint check, push, PR, CI on that SHA.
- Reports: size, cycles, CONFIRMED fixed, DISMISSED (count and reasons), non-blocking PLAUSIBLE, PR, CI.

## T2 Review a third-party PR (kind review; ~30 min; 3 leaves at once; grant `analyse`)
1. Explorer + `review-context` → `context.md` while you freeze base/head of the PR.
2. One `pr-reviewer` `sonnet·low`; big PR: add one high on risk zones; front: biscui reviewer. Light mode (small, no risk): the reviewer's native refuter statuses every CANDIDATE in `review-r<k>.md` (the only case where the reviewer's file carries statuses); a Cockpit challenger for blockers. No native refuter: Cockpit challenger for all.
3. `role-challenger`. PLAUSIBLE blocking: one targeted proof (resume reviewer), then challenger again.
4. Writer: drafts ≤ 2 lines for the CONFIRMED. You write the `review-report` JSON and `final.md`.
- Default exit: all CANDIDATEEs statused, ticket read before the review. Reports: mergeable yes / no / to decide (F<n>), CONFIRMED blockers, JSON path.
- Delta ("check it was handled"): the master resumes you; new snapshot, delta reviewer, challenger, JSON updated.

## T3 Feedback received on my PR (kind review; ~45 min; 3 leaves; grants set the scope)
1. Explorer reads comments (read only) → `comments.md`, one F<n> per comment.
2. Challenger (opus, human author): CONFIRMED / PLAUSIBLE / DISMISSED per comment (keep the human's judgement and a one-line fix in a separate field).
3. Writer: one reply draft per comment.
4. Grant `fix`: implementer → delta review + challenger, max 2 cycles. Grants `commit`/`push`: keeper, one commit per group of points.
- `analyse`: stop after step 3. `fix`: fix CONFIRMED, ask `commit`/`push`. "Fix and push" = `fix, commit, push` on the PR branch, never `pr` or the trunk.
- Work beyond the slice: `BLOQUÉ` (master opens a T1). One grouped question for P1 + P2. Reports: table per comment (status, action, draft), SHA, CI. The user posts.

## T6 Maintain a stack (1-2 leaves)
`pr-ci-keeper` alone, PR by PR in order: merge the base, patch → delta review + challenger → local checks → push (standing grant on an already open PR) → CI. Size over 1000 or structure change: no push, report measured diff, master redispatches. Stop when the stack is green; no permanent watching. Report: stack table (base, conflicts, size, CI, form).

## T5 Verified exploration
One explorer `sonnet·low` (N `haiku·low` only for disjoint scopes, N ≤ budget) → facts; one challenger pass on the `[DEDUCED]` that ground a decision; synthesis keeps only statused facts, the rest shown as unverified.

## T4 Feature in slices (depth 3 only, when the cockpit allows it)
A feature SO runs framer, slicer ⇄ challenger (2 rounds), one slice SO per slice (T1, sequential), then QA; master sees one report per slice and the P1-P5 points. Slice SO launches follow the master's agent budget share. Without depth 3, the master plays the feature SO.
