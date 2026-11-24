# spec-tech learnings

- 2026-11-16 — Origin: merge of a team's slicing suite (slice-ticket, plan-ticket, grilling, publish-plan, implement-plan, implement-slice) with a developer's practice on five tickets. Findings: an OQ of a plan never reached the ticket section (the PM never saw it); the plan had to be realigned after the PM's answers; PM answers written inside the spec made it hard to read → clean up after the answer.
- 2026-11-16 — The spec must be clear and settled, not a proposal. Open questions are the exception, as few as possible; each one goes through an exploration (precedents, sibling tickets, history, cost of the options) to be settled fast in refinement.
- 2026-11-16 — Keep the whole build suite (gh stack, implement-plan, implement-slice, landing), remove nothing. Build and stack live in `build.md`. Conflict between gh stack (rebase + force-push) and H3 settled: exception on the stack's layer branches, `--force-with-lease` only; H3 holds everywhere else.

## 2026-11-16 — feedback on seven specs of one epic
- No "Out of scope" section: if it is in the ticket, it is in scope.
- An OQ whose answer we have (ticket, mockup, code, exploration, factual recommendation) becomes a decision. 11 OQs over 7 specs was too many.
- Lighter specs: nothing that helps neither the dev nor the refinement.
- One trunk per ticket, kept apart: never a trunk shared between tickets of an epic (grouping two tickets was refused).
- No written merge order, no "Trunk PR: to be created" line, tech decisions in one line without a why.
- Do not mention what does not change (a "What does not change" section was removed); decisions stated positively, what is new (e.g. the tech definition of a missing row).
- "Parallelisation and order" only when it brings a real constraint; never "starts from the base, no prerequisite" nor "can run in parallel with…".
- Tech decisions are decisions taken (title "Tech decisions", not "to validate"); what needs a real choice goes to the open questions with the alternative.
- Ticket format: multi-part decisions as a title bullet + sub-bullets (one idea per sub-bullet). Under each spec, one fixed "Questions" block (only the unsettled open questions), no collapsible duplicate list of decisions.
- A decision that contradicts the ticket or the workshop stays an open QUESTION (A spec choice / B alternative / recommendation) in the spec, never "None"; do not move them to a separate block.
- The ticket is the reference: what the functional spec states explicitly is never a question, even against the workshop or our opinion (precise scenario > general rule). A question only if the ticket is silent.
- Validated style: short telegraphic bullets, ≤ ~12 words, one idea per bullet; a PR line = title + what in a few words.
- Under each PR: new or changed command/query (real name), as a sub-bullet.
- 2026-11-17 — "Tech decisions" block: only what is missing elsewhere (new tech definition, non-obvious choice, cross-cutting constraint). Never a repeat of the ticket or the Split; block absent if nothing is left.
- 2026-11-24 — Port to the cockpit: the plan has no "Out of scope" section (it contradicted the rule above); what a sibling ticket owns is a "→ <KEY>" line in the slice and the Handover section. The ticket template lists the new or changed command/query under each PR.
- 2026-11-24 — The names in a spec (tables, routes, queries) are proposals left to the dev. A different name in the code is not a gap to report or fix: renaming would make the other open branches dependent or stale. The code is the reference for names.
