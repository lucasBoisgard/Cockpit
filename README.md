# Cockpit

A web cockpit to run many Claude Code sessions in parallel, one per git worktree, and always know which one needs you.

![The attention queue and a question answered in the conversation](docs/screenshots/01-question.png)

| Review the changes | Orchestrate agents | Read a PR review |
|---|---|---|
| ![Diff of a finished session](docs/screenshots/04-changements.png) | ![Master, phases and agents](docs/screenshots/06-orchestration.png) | ![Review report in colored blocks](docs/screenshots/05-revue.png) |

- **Attention queue**: sessions sorted by what they expect from you: answer, review, or nothing.
- **Answer from the page**: questions, permissions and messages, without hunting for the right terminal.
- **Orchestration**: a master splits a task into phases and runs agents, Claude or GPT.
- **PR reviews**: a review session writes a report in colored blocks.

New to it? Take the **[guided tour](docs/visite-guidee.md)** (10 minutes, in French).

## Get started

You need **Node 20+**, **tmux** and **Claude Code** (signed in).

```bash
git clone https://github.com/lucasBoisgard/Cockpit ~/.claude/cockpit
~/.claude/cockpit/start.sh
```

Open the URL that `start.sh` prints (`http://localhost:8052/?token=…`).

`start.sh` adds the cockpit's hooks to `~/.claude/settings.json` (with a backup) and generates the access token. Sessions that were already open must be restarted (`/exit`, then `claude --resume`) to show up.

## Minimal configuration

Nothing is required. To point the cockpit at a repository other than the current one, create `~/.claude/cockpit/cockpit.config.json`:

```json
{ "repo": "/path/to/your/repo" }
```

Optional:

- **GPT**: install the Codex CLI (`npm install -g @openai/codex`), then sign in from **⋯ → Connexions**.
- **Access from another machine**: start with `HOST=0.0.0.0 ~/.claude/cockpit/start.sh` and add your hostname to `"hosts"` in the config.

> **Security.** The access token gives a shell on the machine. Never share the printed URL, and keep the port on a network you trust.

Every option, the architecture and the security model: **[docs/reference.md](docs/reference.md)**.
