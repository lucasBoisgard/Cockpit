---
name: pick-agent-model
description: Choose the provider, model and effort for an agent a Cockpit master is about to launch, using the relevance matrix (`orchestrate matrix`), then get the agent verified and record its outcome so the matrix learns. Use before every `orchestrate launch`, when relaunching an agent that failed or did poor work, when choosing a reviewer for another agent's work, and after checking an agent's report. Use it even when the right model seems obvious: picking from the matrix and getting the agent verified is what makes the matrix improve.
---

# Pick an agent's model from the matrix

The relevance matrix ranks provider × model × effort for each kind of task. It starts from reference estimates (1 to 5 stars) and gets better from the **verdicts** that verifying agents record on the agents (identified findings, scored out of 100); a master's opinion is not an input. Your job: classify the task, take the right pick, state why, launch with `--kind`, plan its verifier, and record the outcome afterwards.

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
| `large-context` | must hold at once more material than a normal context takes (about 150 k tokens or more read together). Plain data analysis, scripts over files and many files read in turn are `explore`, `summarize` or `implement`, never `large-context` |

Ties: `delicate` beats `implement`/`refactor`, `debug` beats `implement` when the cause is unknown, and `review` always means a review. If one task really falls into two categories, split it into two agents.

## 2. Read the row

Run `orchestrate matrix <category>`. Cost always means tokens against the usage limit, never money. The matrix ranks on value: among picks whose score /100 is good enough (70), the lowest quota cost (measured billed tokens × the model's quota weight) comes first, then the fastest; a pick more than 10 points behind the best score only leads when it is really cheaper (at most 75 % of the best pick's quota cost), so a few tokens saved never buy a much weaker pick. The deep-reasoning categories (`delicate`, `architecture`, `debug`) rank on quality first (the picks within 3 points of the best score, then cost), then quota cost, then duration; `orchestrate matrix <category>` shows each pick's score /100, its confidence (`à éprouver` < `faible` < `moyenne` < `solide`, counted in independently verified observations only), tokens, duration and number of measured agents, with the integrated-as-is, rounds and Arène-rank indicators apart from the score. Read score and confidence together: a score at `à éprouver` or `faible` is mostly the reference, not proof. The quota cost is a proxy (median billed tokens × the model's static weight), not a measured quota. Take the first pick unless you name a reason; if it is Fable and you have no named reason for it (see Fable below), take the next one. Unavailable providers come last. Run `orchestrate models` if you are not sure what is available.

**Provider: balance by quota, not by agent count.** The GPT account is smaller, so an even split would exhaust it. Relevance still has to be judged on both families, and the matrix only learns from agents it sees. Run `orchestrate balance`: it names the provider whose usage windows are the less full (7 days first; the 5 hours window only breaks a tie, or rules a provider out at 90 %), avoiding a provider at 90 % of a window unless the other is as full, and the one whose quota burns faster per unit of work. A provider at 90 % of a window counts as unavailable for Second opinion and Diversity too. Then:

1. Take the first available Claude pick and the first available GPT pick of the category, in the matrix's value order.
2. If their scores are close (a guideline of about 10 points, not enforced by the code), or the GPT pick is flagged `à éprouver`, the provider is the one `orchestrate balance` names.
3. If one side is clearly better (about 10 points or more) at confidence `moyenne` or better, take the better pick and say why.
4. A fan-out (several agents on one phase or one question) follows the balance: both providers when neither is near full, with the same brief and each provider's own pick for the category.
5. GPT is not only a second opinion: it implements, explores, tests, debugs and reviews like Claude does.
6. Stay on Claude only for a named constraint (see Constraint below), never out of habit.

Second opinion, Diversity and Arène mode below override the balance; Exploration only changes the pick inside the provider it chose. Beyond that, take the first available pick of the chosen provider. Move away from it only for one of these reasons, and name the reason:

- **Second opinion**: a `review` of a Claude agent's work, or a competing variant, goes to another family (GPT via `--provider codex`) if it is available. Otherwise use another Claude model than the implementer's.
- **Breadth**: a wide exploration is many small fast agents, one per question, area or source, not one big agent. Escalate to a stronger pick only the findings that need depth. Choose the category per kind of exploration (explore, summarize, architecture) and take the matrix's cheap, fast pick: typically `haiku·low` or the cheap GPT pick for listing, `sonnet` for reasoning about a flow.
- **Diversity**: the same ambiguous or critical question goes to 2+ models, at least one of each provider (`--provider codex` included) and a cross-check agent (or the master, from the reports) compares the answers. This is for questions and explorations, not for writers or diff reviews (see Review passes).
- **Context size**: the material does not fit the top pick's context, so take the best pick that fits.
- **Retry**: the same pick already failed on this task, so go up one step (more effort first, then a stronger model).
- **Constraint**: GPT agents cannot launch sub-agents or load Claude skills. If the brief needs sub-agents, stay on Claude. A skill is not a reason on its own: paste the skill's sheet in the brief of a GPT agent (the role skills say how).
- **Low confidence**: a pick at confidence `faible` or `à éprouver` is still an estimate. Don't let one bad verdict rule out an otherwise strong pick.
- **Arène mode**: while `orchestrate calibration` says `Arène : active` for your orchestration, do not pick one model: the task goes to a `role-model-judge` competition (see the `orchestrate` skill). The rules below apply again once it is off.
- **Coverage queue** (every pick gets evidence, expensive and quality categories included): each 5th launch of any master earns a credit (2 banked at most). When `orchestrate matrix <category>` shows `File de couverture` with a candidate, the candidate is the available pick with a reference of 3 or more and the least verified evidence (a pick far below the best and not cheaper leaves the queue once well evidenced). Spend it with `orchestrate launch --explore --kind <category>`, accepted only for that candidate:
  - **Value category**: the candidate replaces the first pick. Only if the task is not urgent, the work is reversible and a verifier is planned; never a retry, never Fable, never a sensitive or irreversible change, never when the user is waiting. Announce it as `(exploration)`.
  - **Quality category** (`delicate`, `architecture`, `debug`): a **duel**. The candidate runs next to the first pick on the same brief, and one verifier launched with `--verifies judge:<a>,<b>` judges both. Only for a short task (`--minutes` 15 at most, never a sub-orchestrator) and while the candidate provider's 7-day window is under 50 % (`orchestrate balance`); otherwise the launch is refused.
  - **Every exploration needs a verifier**, otherwise it brings nothing: `orchestrate status` flags it `exploration non vérifiée`.
- **Fable**: never a default and never an exploration. It fills the usage limit fastest and has slow turns, so take it only for a named reason said at launch: the task needs its specific strength and a cheaper pick is clearly insufficient. Deep reasoning on a short, important task (delicate change, architecture, hard debug, a decision that is costly to get wrong) is a valid reason: do not hesitate, the quota cost of a short task is small. If the first pick is Fable and you have no named reason, take the next pick. A Fable launch without that reason in its announcement line is a mistake.
- **Hors matrice**: a pick shown `hors matrice` is a combination other masters used with at least one verified observation. It ranks like the others; if it keeps ranking first, propose adding it to the category.

Effort: apply section 2b, not the matrix's number blindly. Use the matrix's first pick as the starting point and check its effort against that grid; change it when size, risk, reversibility, oracle or time budget say so.

## 2b. Calibrate the effort

Effort multiplies time and tokens, so frugality targets long, broad or repetitive work (exploration fan-outs, reviews, implementation loops); the per-agent token budget targets long-lived agents. A short task that needs deep thinking takes the strongest model and `high` effort without hesitation. The matrix gives a starting point; this grid decides. **Default `low` or `medium`. Every `high` needs a stated reason (deep reasoning on a short task is one); `xhigh` and `max` are exceptional.**

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
w4 · implement → claude sonnet / high (1er choix, 76/100, confiance moyenne)
w5 · review → codex gpt-… / medium (2e avis sur le travail de w4)
w6 · architecture → claude opus / medium (exploration, à éprouver)
```

Then launch with `--kind <category>`, plus the provider, model and effort you chose. Without `--kind` the verdicts go nowhere. A verifier takes `--verifies <role>:<ids>` (see §4).

## 4. Verify, then record the outcome

Quality is not rated by you. It is computed from findings recorded by agents launched with a verification mission: `--verifies reviewer|challenger|judge|consumer:<ids>`, ending their final message with the verdict envelope (format and rules: `agent-protocol`; wake-ups, rejected lines and `--capture`: `orchestrate`). Plan one verifier per agent you want evidence on, per `pr-reviewer` and `role-challenger`. A clean verdict from one reviewer weighs a third of an audited one: a challenger or a second verifier makes it count. A blocking finding is the moment to run a challenger.

Once the work is integrated or discarded, record how:

`orchestrate outcome <id> as-is|fixed|partial|redone "<one sentence>"`

`as-is`: integrated untouched; `fixed`: after corrections; `partial`: only partly reused; `redone`: discarded or redone by another agent. The outcome is shown next to the score, never mixed into it; an agent with no verifier is scored from its outcome alone, at low weight and no confidence. It also records the rounds (messages after the first delivery; `send --info` for anything that is not a correction) and the billed tokens and duration. A long-lived agent past its token budget costs more than a fresh one: relaunch instead of resuming. Judge the work, not how hard the task was or how good the brief was: if the brief was the problem, say so in the note.

## On failure

When an agent's work is `redone` or `partial`: record the outcome first, then relaunch per the "Retry" rule (same category, one step up), with a brief that says what went wrong the first time.
