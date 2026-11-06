# Cockpit — reference

The complete reference: every feature, the configuration keys, the layout of the code and the security model. For a quick start, see the [README](../README.md).

> **Warning.** The cockpit gives whoever holds its access token a shell on the machine it runs on, and lets them drive your Claude Code sessions. Keep its port on a network you trust, never share the URL printed by `start.sh`, and read [Security](#security) before exposing it.

A small web cockpit to follow and drive parallel Claude Code sessions started with `claude --worktree`.

For each git worktree it shows the Claude session state (working / needs input / done), the conversation, the live terminal, the changed files and their diff. Sessions running in tmux can be driven from the browser: send messages, answer permission prompts, switch permission mode, start or resume a session, close a worktree. A persistent bash terminal is available as its own card.

"New session" can start a **review** session instead of a free one: give it a pull request, and the session starts with a system prompt that lists the review skills to load (`code-review`, `security-review` and every skill whose name contains "review", or `review.skills` in the config) and asks for a report through the `review-report` skill. The report (`~/.claude/worktree-reviews/<worktree>.report.json`) is shown in a "Rapport" tab as colored blocks: blocking (red, request changes), to fix (amber), suggestion (blue), question (violet), praise (green), context (grey), each with its finding, impact, fix and a draft PR comment to copy.

When an app is configured, every side panel also carries an app button and an App tab: they run the app's launch command once at the root of the main checkout (tmux session `cw-app`) and show its state — stopped, building, starting, up, degraded or KO — with the launch log, restart and stop.

A "Tokens utilisés" card shows how much of the account's usage limits is used (5-hour and 7-day windows, spend limit when there is one) with their reset time. It turns amber at 80 % used and red at 95 %, and the header then shows the limit as an alert. Worktree cards show a "Contexte" chip when 20 % or less of their session's context window is left. The card opens a Tokens tab with the used and remaining share of each limit, each session's remaining context and estimated cost, the tokens processed per day over 7 days and the usage per worktree. Limits, context and cost come from what Claude Code sends to the status line: `statusline.js` writes one snapshot per session in `~/.claude/worktree-usage/`, so the limits shown are those of the last Claude answer. The daily history is read from the transcripts in `~/.claude/projects/` (subagents included).

### Workstation layout

The page is a workstation for a full working day. On the left, the **attention queue** lists every worktree grouped by what you are expected to do: *À toi* (a permission or a question, oldest first), *À relire* (a finished turn), *En cours*, *Au repos*; each row says why. `j`/`k` walk it, `[` folds it to coloured dots. The selected session fills the centre: a one-line header (state, reason, the actions that state calls for, `d` for the details, ⋯ for every worktree action), its tabs and a compact composer whose `⚙ model · effort · mode` pill opens the session settings. The Changements tab shows the uncommitted lines added and removed (`+N −M`), and `f` hides the queue (focus mode). The top bar holds clickable state pills, the terminal, the token limits, `Ctrl K` and a ⋯ menu (tools, theme, fallback card layout). History, cleanup, automations and skills open as pages in the centre, with their own address. The previous card grid stays available from that menu.

### Attention and triage

- **Notifications.** A background loop (every 3 s, even with no page open) turns session transitions into events: permission asked, question asked, turn done, CI failing, PR merged, app KO, automation run. They show as short pills in the header (card name and state, full text on hover, click to open the session), and the card that just finished gets a green ring until it is opened. The tab title carries the number of sessions waiting for you and the favicon turns amber. With `notify.ntfyUrl` set, events are also posted to an ntfy topic for phone push.
- **Peek and quick reply.** A card shows Claude's last message (click to unfold), a short reply field, and for a pending permission or `AskUserQuestion` the matching buttons (they send the option number to the session).
- **Grouping and pins.** "Par état" groups worktrees into pinned, waiting for you, ready to review, working and others, sorted by last activity. ☆ pins a card on top in both orders.
- **Keyboard.** `Ctrl K` opens a command palette; `j`/`k` move between cards, `Enter` opens, `Space` unfolds, `a` allows the pending permission, `1`-`9` switch tabs, `n` new session, `h` history, `?` help.

### Questions answered in the conversation

When Claude asks a question (`AskUserQuestion`) in a session launched or resumed by the cockpit, the conversation shows a card with every question, its options and their descriptions, multi-select and a free answer; "Répondre" sends the answers to Claude, and the terminal never shows the dialog. Under the hood the `ask-relay.js` hook (`PreToolUse` on `AskUserQuestion`, given by the cockpit to every Claude session it launches or resumes with `--settings`, so nothing is added to `~/.claude/settings.json`) holds the question in `~/.claude/worktree-asks/` and answers Claude with `updatedInput` once the cockpit writes the answer (Claude Code 2.1.85 or later). "Répondre dans le terminal", no answer within 25 minutes, or a session started outside the cockpit (the cockpit marks its own with `COCKPIT_ASK=1`) leave the usual terminal dialog. Permission prompts get a card too (Autoriser, Toujours, Refuser, with the provider's keys), and so do questions of sessions the relay does not cover, whose options are typed into the terminal.

### Steering several sessions

- **One send, routed for you.** The composer has a single "Envoyer", like the CLI: the message always reaches the session, and while Claude works it is taken into account during the turn (Claude Code queues it itself). While Claude waits on a question or a permission, the message is held and leaves right after the answer. When a long message is sent to a busy session, a small model (`claude -p --model haiku`, about 2 s, `server/core/routing.js`) reads it against the current task: a clearly independent task starts a new session in the same worktree instead, and a toast says why. Short messages, follow-ups and slash commands skip that check.
- **Broadcast.** "Outils → Écrire à plusieurs sessions" selects cards and sends one message to all of them (busy ones get it queued).
- **Variants.** "Nouvelle session" can start N worktrees with the same prompt to compare approaches.
- **Delegation.** "Déléguer" on a Claude message starts a linked session pre-filled with that context. Cards show the parent and child links, and the parent can be told when the child finishes a turn.
- **Automations.** "Outils → Automatisations" starts a session with a prompt every day at a set time or every N minutes, in a fixed worktree or a new dated one.

### Providers: Claude and GPT

Sessions and agents run on a **provider**: Claude Code by default, or GPT through the OpenAI Codex CLI (`npm install -g @openai/codex`, then sign in from "⋯ → Connexions"). "Nouvelle session" picks the provider, its model, effort and permissions; a master can launch GPT agents with `orchestrate launch --provider codex --model <model>`. A GPT session gets the same queue row, conversation (read from its Codex rollout), changes, terminal and approval buttons as a Claude one, tagged "GPT".

The cockpit tracks a Codex session with the same state hook as Claude Code, passed with `-c hooks.<Event>=…` when it launches the session. Before those hooks run, Codex asks, once per repository, to trust the folder, and once for the cockpit's hooks (trust kept per hook content, so after the cockpit moves or its hook changes it is asked again); it may also offer an update. The cockpit remembers the Codex sessions it launches (`~/.claude/worktree-codex-launches.json`), reads the screen of those not attached to a state yet and shows the prompt in the queue and the conversation, with its options as buttons; a choice is relayed with arrow keys and Enter, so Codex makes and saves the decision itself. When no prompt shows and the hooks are not trusted yet, "Ouvrir la revue des hooks" types `/hooks` for you. "⋯ → Connexions → Autoriser GPT sur un dépôt" starts a bare Codex session in a chosen repository to go through these prompts before any work. Codex sessions started outside the cockpit are not tracked. Permission modes map to Codex sandboxes: plan → read-only, default and accept edits → workspace-write with approval on request, auto → `--approve-for-me`; the cockpit never bypasses approvals or sandboxes. `providers.codex.bin` (or `CODEX_BIN`) sets the Codex binary; `GET /api/providers` lists the providers, whether Codex is logged in and its model catalog.

### Relevance matrix

A master picks each agent's provider, model and effort from a **relevance matrix**: for each kind of task (explore, summarize, implement, frontend, tests, refactor, debug, delicate change, architecture, review, very large context), ranked picks with a reference score from 1 to 5 and the reason, plus each model's cost, speed and context. The default lives in `server/data/model-matrix.json` (versioned, shared through git: initial estimates); edits made on the "⋯ → Matrice des modèles" page are kept in `~/.claude/worktree-matrix.json` and win over the default, category by category ("Revenir au défaut" drops them).

The matrix learns: a master launches an agent with `--kind <category>` and, once it has checked the work, rates it (`orchestrate rate <id> <1-5> "<note>"`). Ratings go to `~/.claude/worktree-matrix-ratings.json`; the page and `orchestrate matrix [category]` show the observed average next to the reference score, and the ranking blends them (the reference counts as two ratings). Picks of a provider that is not available (Codex not logged in) come last. Routes: `GET /api/matrix`, `POST /api/matrix/category`, `POST /api/matrix/reset`, `POST /api/orch/rate`.

### Connections: AI providers and MCP servers

"⋯ → Connexions : IA et MCP" gathers everything the cockpit connects to.

- **AI.** Claude and GPT each show whether they are signed in (account, method, expiry). Sign-in works from the container, without a browser on it: GPT with a ChatGPT account runs `codex login --device-auth` and the page shows the link and the one-time code to enter on any device, then notices when it is approved; GPT can also take an OpenAI API key, handed to `codex login --with-api-key` on stdin and never stored by the cockpit; Claude runs `claude auth login` (subscription or Anthropic console), the page shows its link and takes the code its page gives back. Each sign-in runs in its own tmux session (`cw-login-claude`, `cw-login-codex`).
- **MCP servers, for the whole application.** There is no per-worktree context: a server added here goes to Claude's user scope and to Codex's global config (Claude and GPT by default), so every session of every worktree gets it. The list groups claude.ai connectors, Claude, Claude plugins and GPT, marks the servers both providers have, and shows each one's transport, target, the names of its env variables and headers (never their values) and its health (`claude mcp list`, run in the background and cached 5 minutes). "Aussi pour GPT" / "Aussi pour Claude" copy a server to the other provider server-side (secrets included, never through the page). Servers a repository declares (its `.mcp.json`, or Claude's local scope, kept per main repository) are listed apart: "Rendre global" copies one to the user scope. "Se connecter" types an MCP server's OAuth login into the terminal; "Retirer" removes a server. Routes: `GET /api/connect`, `POST /api/connect/codex/device|codex/key|claude|claude/code|cancel`, `GET /api/mcp`, `POST /api/mcp/add|remove|share`.

### Agent orchestration

"Nouvelle session → Maître" starts a **master** session: it does not code, it plans the goal in phases, launches **agents** (separate Claude sessions in tmux, each with its own model, effort, permission mode and skills), follows them, unblocks them, checks and integrates their work and reports to you. Its rules live in the `orchestrate` skill (`skills/orchestrate/SKILL.md`), and it drives its team with `bin/orchestrate.js` (`status`, `plan`, `skills`, `launch`, `read`, `send`, `stop`, `resume`), which calls the cockpit API as the calling session (`CLAUDE_CODE_SESSION_ID`).

- **The tree.** A master opens on its "Orchestration" tab: a full canvas with the tree master → phases → agents → sub-agents (or grouped by agent), links coloured by state, collapsible branches and zoom. Clicking a node opens a floating inspector: the master's goal, settings and event log; an agent's settings, brief, files, its permission prompt, its conversation and last report, a box to write to it, stop or relaunch. `e` opens a floating box to write to the master; Pause and Réglages (autonomy, active-agent limit, agents' permission mode, end) sit on the canvas. The ⋯ menu of any running session can promote it to master.
- **Waking up.** After launching agents the master ends its turn. When an agent ends a turn, the background loop queues a short report for its master (or its parent agent); several reports arriving together are merged into one message. The master stays "working" on its card while any of its agents works.
- **Where agents work.** In the master's worktree by default; with `--isolated`, in a new worktree on a branch made from the master's `HEAD` (`<branch>--wN`), which the master merges.
- **Questions.** Agents never ask you: a blocked agent ends its turn with "BLOQUÉ : …" and the master answers it, or asks you depending on its autonomy level (only when blocking, at key steps, or at every decision). Permission prompts of agents still reach you.
- **Permission mode of the whole team.** Changing the agents' permission mode in Réglages applies to everyone, at any depth, not only to later launches (saving the same mode again touches nothing). Each agent stores the new mode (a resume always passes `--permission-mode`, `default` included) and is reached the safest way for its state: an idle Claude prompt gets Shift+Tab one press at a time, the footer read back and the session checked idle before every press (in a dialog Shift+Tab confirms the choice, so a session that works is never pressed); it stops at the target, or relaunches with `--resume` when the target is not in that session's cycle (auto may be missing), and never rests on bypass; an agent blocked on a permission prompt is relaunched with `--resume <session> --permission-mode <mode>` and told the mode changed, its conversation kept; a GPT agent is relaunched the same way once idle or blocked (Codex has no live switch); a stopped agent only stores it. A relaunch is refused before anything is killed when the orchestration is paused, over its agent limit or the worktree is gone; one that fails after the kill is reported to the master. An agent that works, a question dialog, an agent still starting are marked pending (⏳ in the tree) and switched when the turn ends, or relaunched if a permission prompt comes first; an agent that finished its turn is never woken for it. The master is never restarted: its prompt is cycled once idle. The settings event and the toast say how many agents were updated. Agents launched afterwards, by the master or by an agent, take the current mode; `orchestrate launch --mode` is accepted only when stricter than it (plan, or default under accept-edits), and such an agent keeps its own mode when the setting is loosened. A new autonomy level goes at once to agents that work and with the next message they receive to the others (no message starts a turn for a finished agent); agents' rules name their real parent (master or agent), carry the autonomy level, and only mention sub-agents when the depth limit allows them.
- **Limits.** The cockpit refuses launches beyond the maximum number of active agents, beyond two levels of sub-agents, while the master is paused, and any permission mode that skips permissions. Pausing holds the reports and hands them over on resume.
- **API.** `POST /api/orch/start|promote|plan|launch|stop|resume|send|pause|settings|end`, `GET /api/orch?caller=`, `/api/orch/read?caller=&id=`, `/api/orch/skills`. The state is in `~/.claude/worktree-orchestration.json` and in the snapshot's `orchestrations` (per master: phases, current phase, state, counts, agents with live status and last action, events).

### Review and delivery

- **Diff comments.** In "Changements", `+` on a line adds a comment; "Envoyer à Claude" sends all pending comments as one structured message. Report blocks have "Faire corriger par Claude" and "Voir dans le diff".
- **PR and CI.** With `gh` logged in, each card shows its PR (number, draft, CI running or failing, changes requested, ready, merged), refreshed every minute. A PR tab lists checks, reviews and a "ready to merge" banner, and sends a failing check's log to Claude. "Pousser et ouvrir la PR" pushes the existing commits (no add, no commit) and opens the PR from a template with the configured labels and assignee, then checks them and the absence of a generated footer.
- **Archive and cleanup.** "Archiver" stops the sessions and removes the worktree but keeps its branch and conversation; archived worktrees can be restored, with their session resumed. "Outils → Nettoyage" lists every worktree with its idle time, disk size and git state, for bulk archive or close (close only for merged branches).
- **Serve the app from a worktree.** "Servir l'app" checks the main checkout out on the worktree's last commit (detached HEAD) and restarts the app; "Revenir au checkout principal" puts it back. Refused when the main checkout has uncommitted changes.
- **History.** "Outils → Historique" lists and searches every past session of the repo (messages and edited files), opens it read-only, resumes it in tmux (recreating its worktree from the branch if needed) or starts a new session with its context.

"Outils" also picks the theme: system, light or dark (the "atelier" palette: warm ground, saffron for what waits for you, jade for what is ready to review, slate for what is working, violet for orchestrators).

No npm dependency and no build step: Node, git and tmux only (`gh` for the PR features).

## Install

1. Clone into `~/.claude/cockpit`.
2. Copy `cockpit.config.example.json` to `cockpit.config.json` and fill it in (optional, see below).
3. Run `~/.claude/cockpit/start.sh`. Through `install.js` it merges the missing `settings.snippet.json` entries into `~/.claude/settings.json` (backup `settings.json.bak-cockpit-<timestamp>`, existing hooks and an existing `statusLine` are kept), links `skills/*` into `~/.claude/skills/` and generates the access token. It is idempotent and runs on every start; later starts are automatic through the `SessionStart` hook.
4. Claude Code loads hooks when a session starts, so sessions already open do not report to the cockpit: quit each one (`/exit`) and reopen it with `claude --resume`. New sessions need nothing.
5. Open the URL printed by `start.sh` (`http://<host>:8052/?token=…`).

## Configuration

`cockpit.config.json` is git-ignored. Every key is optional; `${VAR}` in a value is replaced by that environment variable.

| Key | Default | Role |
| --- | --- | --- |
| `repo` | main checkout of the current directory | Main repository: new sessions, the app and the history work on it |
| `repos` | none | Other repositories whose worktrees are shown. The cockpit's own repository and every repository where a Claude session ran in the last 14 days are shown anyway, each card labelled with its repository |
| `container` | none | Docker container to run in: `start.sh` re-runs itself there with `docker exec` |
| `hosts` | `[]` | Extra hostnames allowed in the `Host` header |
| `claudeBin` | `~/.local/bin/claude` | Claude Code binary used for sessions started from the cockpit |
| `review.skills` | `code-review`, `security-review` and the skills named `*review*` | Skills a review session is told to load |
| `app.command` | none (no app button) | Launch command, run in the main checkout |
| `app.processManager` | none | `pm2` to read process states and run `pm2 delete all` before a restart and on stop |
| `app.pm2Bin` | `node_modules/.bin/pm2` of the repo, else `pm2` | pm2 binary |
| `app.healthUrl` | none | URL polled to tell starting from up (a 503 counts as not answering) |
| `app.url` | `app.healthUrl` | "Open the app" link |
| `app.recoveryDoc` | none | Troubleshooting doc, relative to the repo, shown on KO and read by the `run-app` skill |
| `app.migrations.paths` | none | Migration folders, relative to the repo. When their content at `HEAD` changed since the last successful run (a pull), the migrations run: after `app.command` on the next start, or right away when the app is already running |
| `app.migrations.command` | none | Command that applies the migrations, run in the main checkout; it must be idempotent |
| `pr.base` | `master` | Base branch for PRs, merged checks and cleanup |
| `pr.labels` | `[]` | Labels pre-filled in "Pousser et ouvrir la PR" |
| `pr.assignee` | none | Assignee pre-filled in "Pousser et ouvrir la PR" |
| `pr.template` | TL;DR / Ticket / Points d'attention / Comment tester | PR body template; `{ticket}` is replaced by the ticket id found in the branch name |
| `providers.codex.bin` | `codex` | Codex CLI binary used for GPT sessions and agents |
| `notify.ntfyUrl` | none | ntfy topic URL that receives events (sent outside your network: use a private topic) |
| `notify.types` | `needs_input`, `permission`, `question`, `ci_failed`, `app_ko`, `migrations_failed` | Event types posted to ntfy |

Environment variables: `PORT` (default 8052 through `start.sh`), `HOST` or `COCKPIT_LISTEN` (default `0.0.0.0` inside a container, `127.0.0.1` elsewhere), `MACHINE_HOSTNAME` (allowed host and printed URL), `COCKPIT_HOSTS` (comma-separated extra hosts), `REPO` and `CLAUDE_BIN` (override the config).

## Layout

| File | Role |
| --- | --- |
| `server.js` | Entry point, requires `server/main.js` |
| `server/config.js`, `server/cache.js` | Configuration, paths and constants; the snapshot cache |
| `server/http.js` | Authentication, host allowlist, write guard, route tables, page and `web/` assets |
| `server/io/` | Everything that touches the outside: processes, git, tmux, gh, `/proc`, JSON stores |
| `server/core/` | Pure decisions without I/O (git parsing, session status, PR, app state, usage, transcripts, automations, orchestration, providers), unit-tested |
| `server/features/` | One module per feature (worktrees, snapshot, sessions, terminal, queue, events, tick, changes, pr, app, chat, history, usage, commands, automations) |
| `index.html` | The page skeleton: header, panel and dialogs |
| `web/css/` | Styles, one file per feature area, loaded in cascade order |
| `web/fonts/` | Atkinson Hyperlegible and JetBrains Mono (SIL Open Font License), served locally so the page needs no outside request |
| `web/js/` | The UI as ordered classic scripts sharing one global scope, one file per feature; `markdown.js` and `format.js` are also required by the tests |
| `test/` | `node:test` unit tests: `node --test` |
| `hooks/state-transition.js` | The hook's pure state transitions (status, turn start, working time), unit-tested |
| `bin/orchestrate.js` | Command line a master session (or an agent allowed to) uses to plan, launch, read, message and stop its agents |
| `skills/orchestrate/SKILL.md` | Claude Code skill: how a master plans, picks each agent's model, effort and skills, and integrates their work |
| `start.sh` | Runs the install, installs tmux if missing and (re)starts the server |
| `install.js` | Idempotent install: hooks and status line in `~/.claude/settings.json`, skill links, access token |
| `ensure.sh` | `SessionStart` hook: starts the server when it is not running |
| `cockpit.config.example.json` | Configuration template |
| `hooks/worktree-state.js` | Claude Code hook writing one JSON state file per session in `~/.claude/worktree-state/` |
| `hooks/ask-relay.js` | Claude Code hook that holds a question of a cockpit session until it is answered in the conversation |
| `statusline.js` | Claude Code status line: worktree, branch, dirty files, unpushed commits; also writes the session's usage snapshot to `~/.claude/worktree-usage/` |
| `skills/run-app/SKILL.md` | Claude Code skill: start, stop and check the app from any session through the cockpit API |
| `skills/review-report/SKILL.md` | Claude Code skill: the JSON format of a review report rendered by the cockpit |
| `settings.snippet.json` | The `statusLine` and `hooks` entries merged by `install.js` |

## Security

- Access token: `install.js` generates a 256-bit random token in `token` (mode 600, git-ignored). The page stores it in its own `localStorage` (not a cookie, which other apps on the same host would receive), removes it from the URL and sends it as `X-Cockpit-Token` on every API call. It is compared in constant time. Rotate it with `rm ~/.claude/cockpit/token && ~/.claude/cockpit/start.sh`.
- Host allowlist: every request, the page included, is refused with a 421 unless its `Host` is `localhost`, `127.0.0.1`, `$MACHINE_HOSTNAME` or listed in `hosts` / `COCKPIT_HOSTS`. This blocks DNS rebinding.
- Write routes also require a `POST` with the `X-Cockpit: 1` header and a same-origin `Origin`.
- Outside a container the server listens on `127.0.0.1` only.

## Notes

- Only sessions running in tmux can be driven; others are read-only. "Reprendre dans le cockpit" reopens a read-only session in tmux with `claude --resume`.
- A session counts as running in tmux when its state file names a live pane, or when Claude Code's own registry (`~/.claude/sessions/<pid>.json`) maps it to a live pane and its process is alive. The second check keeps a session drivable after the same conversation was resumed in another terminal.
- Sessions with no message (no transcript) are hidden unless they are running, and so are sessions whose worktree directory was removed.
- `index.html`, `web/` and `server/` are read at startup: after editing them, click "Recharger le cockpit" (it reruns `start.sh`) or rerun `start.sh`.
- The server keeps its own data in `~/.claude`: `worktree-events.json` (notifications), `worktree-queue.json` (queued messages), `worktree-links.json` (delegations), `worktree-archive.json`, `worktree-automations.json`, and `worktree-app-serve.json` (app served from a worktree), and `worktree-orchestration.json` (masters, their phases, agents and events), `worktree-matrix.json` (local edits of the relevance matrix) and `worktree-matrix-ratings.json` (ratings of agents).
- Only one server should run its background loop at a time. `start.sh` turns it on with `COCKPIT_TICK=1`; an instance started directly with `node server.js` (a test instance) does not send queued messages, run automations or record events.

## Uninstall

1. Remove the cockpit entries from `~/.claude/settings.json` (the `statusLine` and the hooks pointing to this directory), or restore the `settings.json.bak-cockpit-*` backup written by the install.
2. Remove the skill links: `rm ~/.claude/skills/run-app ~/.claude/skills/review-report`.
3. Stop the server (`kill "$(cat ~/.claude/cockpit/server.pid)"`) and delete `~/.claude/cockpit`. `~/.claude/worktree-state/`, `~/.claude/worktree-reviews/`, `~/.claude/worktree-usage/` and the `~/.claude/worktree-*.json` data files can be deleted too.
- Claude Code auto mode refuses edits to `~/.claude/settings.json` and to the tmux driving code: switch to the default permission mode first.
