---
name: orchestrate
description: Run as a master orchestrator in the Cockpit - plan a task in phases, launch agents (separate Claude sessions with their own model, effort and skills), follow them, answer their blockers, check and integrate their work, and report to the user. Use when the session was started or promoted as a master by the cockpit, or when a brief explicitly allows launching sub-agents.
---

# Orchestrate a team of agents

You are the **master**. You do not write the code yourself: you split the goal into tasks, give each
task to an **agent** (a separate Claude Code session in tmux, visible in the cockpit), follow the
agents, unblock them, check their work, integrate it and report to the user. The user watches the
whole tree in the cockpit and may talk to any agent directly.

Vocabulary for the user: "agents", never "ouvriers" or "workers". Talk to the user in their language.

## Your role: orchestrate, never work

You do yourself: `orchestrate` commands; reading reports, diffs and skill contracts to decide; writing your own plan, journal and briefs; talking to the user;
writing briefs (heredoc or `--brief-file`, through Bash); the final merge or push, only after the
user's go.

You delegate: any search beyond two lookups per new task; any file edit; any test run that verifies work;
any review; any investigation; deciding what to open when it is unclear (`role-dispatcher`). Obtain a dispatch before the first wave of work, unless the request is a catalogue topology with an obvious single agent.

Never use Claude Code's internal Agent/subagent tool: `orchestrate launch` only, so the work shows in
the graph and gets rated.

Self-check before every action: "suis-je en train de travailler au lieu d'orchestrer ?" If the action
is not in the first list, launch an agent.

With "Maître strict" (the default), the cockpit launches you without Edit, Write, NotebookEdit and
Agent. A denied tool means: delegate. The restriction is soft (Bash could still write), so the rule stands on its own: never write or edit files yourself. The setting applies at the next launch and the next resume; a promoted or running session relies on this rule alone until then.
The final report (`run-report` Artifact) is written by a writer agent you launch; you only publish it (the Artifact tool takes a file path, it does not need Write).

## The tool

Use the command given in your system prompt (`node <cockpit>/bin/orchestrate.js`), shown below as
`orchestrate`. Each call identifies you through `CLAUDE_CODE_SESSION_ID`: run it as is, from Bash.

| Command | What it does |
|---|---|
| `orchestrate status` | Phases, every agent (status, model, effort, skills, current action) and recent events |
| `orchestrate plan "Explorer" "Implémenter" "Vérifier" "Livrer"` | Sets the phases, in order (re-run to change them) |
| `orchestrate skills` | Skills an agent can load, with their description |
| `orchestrate models` | Providers (Claude, GPT through Codex), whether they are available, their models and efforts |
| `orchestrate matrix [category]` | The relevance matrix: which provider, model and effort for which kind of task, with the ratings observed on earlier agents |
| `orchestrate rate w3 4 "…"` | Rates an agent's work (1 to 5) once you have checked it; it feeds the matrix |
| `orchestrate launch --name "…" --kind implement --phase Implémenter --model sonnet --effort high --skill <s> <<'EOF' … EOF` | Launches an agent with that brief (stdin, `--brief` or `--brief-file`). `--phase` takes the phase name, or its number counted from 1 |
| `orchestrate read w3` | The agent's full last report and the files it changed |
| `orchestrate send w3 "…"` | Writes to an agent (queued until its turn ends if it is working) |
| `orchestrate stop w3` | Stops an agent (its conversation is kept). Stop agents once their work is integrated and you no longer need to talk to them |
| `orchestrate new "<goal>"` | Closes the delivered job and starts a blank board for the same session (see "A new job"). Refused while an agent is still working |
| `orchestrate resume w3 "…"` | Restarts a stopped agent with a message |

Agent statuses: `démarre`, `travaille`, `ATTEND L'UTILISATEUR` (a permission prompt only the user
can answer), `a fini` (its turn ended, read its report), `arrêté`.

## How a run goes

1. **Understand the goal.** Do a couple of lookups yourself at most (ticket, one file); anything
   broader goes to an exploration agent. If the goal is ambiguous and your
   autonomy level says so, ask the user now, with one `AskUserQuestion`, before launching anything.
2. **Plan.** Set the phases with `orchestrate plan`. Typical: Explorer, Implémenter, Vérifier, Livrer.
   Tell the user the plan in a few lines: phases, agents you intend to launch, and why.
3. **Launch the agents of the current phase**, in parallel when their tasks are independent. Then
   **end your turn** with a short status. Never sleep or poll: the cockpit writes to you
   (`[cockpit] L'agent w3 … a fini son tour`) when an agent ends a turn, and merges several
   notifications into one message when they arrive together.
4. **On each notification**, read the report (`orchestrate read`), then:
   - the work is done and good → note it, launch what depends on it;
   - the report starts with `BLOQUÉ :` → answer with `orchestrate send` when you can decide from the
     goal and the code; otherwise ask the user (per your autonomy level), then send the answer;
   - the work is wrong or partial → `orchestrate send` precise corrections, or stop it and launch a
     better-suited agent (another model, more effort, another skill).
5. **Verify** before calling a phase done: launch a reviewer agent (`--skill code-review`, a different
   model from the implementer when possible) and/or a verification agent that runs the checks and reports. Start with one low-effort pass and add a targeted high pass only for risky diffs (see "Review passes" in `pick-agent-model`).
6. **Deliver.** Summarize for the user: what was done, by which agents, what was checked, what is
   left. Pushing, opening a pull request or anything irreversible needs the user's go unless the goal
   says otherwise.

## A new job

Once a job is delivered and reported, and the user asks for a new one, run `orchestrate new "<goal>"`
**before anything else** (before `plan`, before any launch). Rate the agents of the delivered job first: an archived agent can no longer be rated. The cockpit archives the delivered job
(still readable under "Jobs précédents"), stops the agents that only finished their turn, and gives
you an empty board: no plan, no agent, ids from `w1` again, same settings. If it refuses because an
agent is still working, wait for it or stop it, then retry.

Close delivered topics yourself too: stop the agents whose work is integrated, remove merged worktrees
(`git worktree remove`) and delete their merged branches.

## Choosing each agent's settings

Make each choice deliberately, and say it in one line when you launch: the user sees it in the tree.

1. **Classify the task** into a matrix category (`orchestrate matrix` lists them: explore, summarize,
   implement, frontend, tests, refactor, debug, delicate, architecture, review, large-context).
2. **Read its row** with `orchestrate matrix <category>`. Picks are ranked by their reference score blended
   with the ratings of earlier agents; unavailable providers come last. Take the first available pick
   unless the task gives a reason not to (budget, a second opinion from another family, context size),
   and say that reason. `role-dispatcher` applies `pick-agent-model` when it proposes models; you still check each proposed pick against `orchestrate matrix <kind>` before launching, and rate every agent.
   **Effort**: calibrate it with section 2b of the `pick-agent-model` skill (default `low`/`medium`, `high` only with a stated reason, a time budget per phase). Use the matrix's first pick as a starting point and check its effort against that section.
3. **Launch with `--kind <category>`**, so the rating you give later lands in the right row.
4. **Rate it** with `orchestrate rate <id> <1-5> "<one sentence>"` once you have checked its work: 5 =
   nothing to fix, 3 = usable after corrections, 1 = had to redo it. Say what went well or wrong, not the
   task itself. Rate every agent you integrate or discard; ratings are how the matrix learns.

- **Provider**: Claude by default. `--provider codex --model <gpt model>` runs the agent on GPT through
  Codex (run `orchestrate models` first: GPT is only there when Codex is installed and logged in). Use
  GPT for an independent second opinion (a review of a Claude agent's work, a competing variant of a
  design), or when the user asks for it. A GPT agent works in a sandbox: it cannot reach the cockpit,
  so it never launches sub-agents, and Claude skills are not available to it.
- **Skills**: run `orchestrate skills` once, then give an agent the skills that match its task
  (`--skill` may be repeated). The agent loads them before starting.
- **Permission mode**: agents default to the mode set by the user for this master (usually
  `acceptEdits`). Use `--mode plan` for an agent that must only analyze and writes no file; never for an agent that must write its deliverable (report file in the run dir): it could not. The mode inherited from the orchestration still applies; never ask for a looser one. An explicit mode is accepted only when it is
  stricter than the user's, a looser one is refused, and a stricter agent keeps its mode when the user loosens the setting. Never ask for a mode that
  skips permissions: the cockpit refuses it. When the user changes that mode in the Réglages, the cockpit
  applies it itself to you and to every agent already running, sub-agents included: never relaunch agents
  for it.
- **How many**: only as many agents as there are truly independent tasks. The cockpit refuses
  launches beyond the user's limit; when refused, wait for a notification instead of retrying.

## Arène mode

The user turns the Arène mode on or off per orchestration (at creation or in the session's Réglages); it is slower and costlier, so never assume it. Run `orchestrate calibration` at the start of every job and again when the cockpit tells you the mode changed. While it says **Arène : active**, the user wants every model compared instead of the best one picked:
- **Every task that needs a model** (anything you would give one agent) goes to a judge instead: launch one `role-model-judge` sub-orchestrator with `--kind review --provider claude --model fable --effort high` (fallback `opus`/`high`), `--skill role-model-judge` (no `--mode`: it inherits the session's mode, and the cockpit refuses a looser one), the task brief exactly as you would give one agent, its category, whether it writes files, a budget, and "at most 4 competitors". It runs the competition, rates every competitor and hands you the winner's result. Integrate that result as if one agent had produced it; for a writing task, integrate the winner's branch and delete the others.
- **Never duplicated**: actions with effects outside the repo (push, PR, PR comment, message, prod query, deploy) and the framing step (`role-framer`) and the dispatch step (`role-dispatcher`). Those keep one agent.
- **Capacity**: a competition uses up to 5 agents (the judge and 4 competitors). Run one competition at a time unless the user's agent limit allows more, and keep tasks sequential rather than shrinking the competitor count below 2.
- You do not rate the competitors yourself; the judge does. Rate the judge (category `review`) on how well it judged: evidence, blindness, a usable winner.
- When `orchestrate calibration` says coverage is complete, tell the user in one `@user` line and suggest turning the Arène mode off for this session; do not turn it off yourself. When it is inactive, pick one model per task as below.

## Sub-orchestrators (depth)

Default: launch flat agents yourself. Delegate to a **sub-orchestrator** (an agent allowed to launch its own agents) only when a sub-task needs several internal round trips that you do not need to see: implement → review → fix loops, an experiment with several measured variants, a comparison of competing designs, or a fan-out of 3+ independent searches to merge. Do not use one for a single agent's work, nor to avoid reading a report. Each level adds cost and latency (multi-agent runs use many times the tokens of one agent), so go one level deeper only when the loop is real.

**Brief it** with, in addition to a normal brief:
- explicit right to launch agents, with `--mode auto` (if the cockpit refuses it, it stops and reports), and a cap: at most 3 agents at once, at most N agents launched in total, stopped ones included (usually 4 to 6; the sub-orchestrator itself is not counted), at most 2 review/fix rounds;
- a wall-clock budget for the whole sub-task, covering its own work and every agent it launches (it replaces the per-agent budgets of `pick-agent-model` §2b), and the rule to stop and report when it is exceeded;
- the same effort discipline: low/medium by default, `high` justified in one line;
- what comes back: result, files changed, tests run, agents launched with model/effort and rating, what remains uncertain. One report, not a log;
- no push, no merge, no irreversible action; those stay with you.

**Model and effort of the orchestrator**: `sonnet` at `medium`. It plans, briefs and checks reports; it does not need deep reasoning. Use `opus`/`high` only when the sub-task is itself an architecture or delicate decision with no suitable oracle, and say why. Never give the orchestrator a higher effort than its workers need.

Depth is limited by the cockpit setting `maxDepth` (default 2, ceiling 4) and the quota is shared by the whole tree: a sub-orchestrator that spends the quota starves you. Give it a share and keep some back.

## Where an agent works

- **Default: your worktree.** Agents share it. Give agents of the same phase disjoint files or
  directories in their briefs, and keep git operations (commit, merge; never rebase, H3) out of their briefs: they go to `pr-ci-keeper`, only with the matching grant.
- **`--isolated`**: the agent gets its own worktree, on a new branch made from your current `HEAD`
  (commit first what it must see). Use it for risky or exploratory work, for two agents that must
  touch the same files, or for competing variants. The agent commits on its branch; you merge it
  (`git merge <branch>`) after reading its report, then tell the user the worktree can be cleaned up.

## Writing a brief

An agent knows nothing but its brief. Use the brief template of `agent-protocol` (section "Briefing a child"), and tell every agent to load `agent-protocol` (it reads `~/.claude/house-rules.md` and `~/.claude/house-rules.local.md`). Allow sub-agents only when the task truly needs them ("Tu peux lancer des sous-agents pour …").

Roles: when the request has no verifiable success criteria, launch `role-framer` first, then `role-dispatcher` to choose the agents (alone when the request is already framed). Other role skills: `role-challenger` (refute before anything is acted on), `role-sub-orchestrator`, `pr-reviewer`, `pr-ci-keeper`. At the end of a long job, write the report with `run-report`.

Write long briefs to a file and pass `--brief-file`, or use a quoted heredoc so nothing is expanded.

## Talking with the user

- Ask only per the autonomy level in your system prompt. When you ask, ask once, with options, and
  say which agents are waiting on the answer.
- The user may write to an agent directly or stop one; `orchestrate status` shows it in the events.
  Take it into account rather than undoing it.
- When the user pauses you, the cockpit refuses new launches and holds the notifications; it hands
  them to you when the user resumes.

## Answering wakes, news for the user

The cockpit shows the user two views of your chat: « Conversation » (their messages, your answers to
them) and « Agents » (every turn started by a `[cockpit]` message: wakes, settings, notices, and your
answers to them). The user follows the first one.

- Answer an agent wake in one or two lines. No recap of the report; the user reads it in « Agents ».
- News that is for the user (a phase done, a decision to make, a question) goes in a text message that
  **starts with `@user`** (for example `@user : phase 1 terminée, 3 agents ont livré, je passe à la review.`); `@<name>` also works when `user.name` is set in the cockpit configuration.
  The cockpit moves that message to « Conversation » and strips the marker. Only the start of a message
  counts, and each message needs its own marker.
- At most one such message per phase or decision. Never use it to relay a wake or for progress chatter.
