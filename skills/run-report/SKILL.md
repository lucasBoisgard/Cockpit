---
name: run-report
description: Write the final report of an orchestration or any long piece of work as a short, scannable Artifact (verdict, what changed, key decisions, what was verified, what is left). Learns from the user's feedback on readability and relevance through a learnings file. Use whenever the user asks for a "rapport final", "rapport de fin", "résumé du travail", "fais-moi un rapport", "bilan", or when a Cockpit orchestration or a long task ends and the result must be reported, even if the word "report" is never said.
---

# Run report

Produce one short Artifact that tells the user, in under two minutes, what happened and what they must do next. Long, ugly, dense pages get rejected: brevity is the feature, not a style choice. Content shown to the user is in their language (the examples below are in French); this file and `learnings.md` stay in English.

## 1. Load the learnings first

Read `~/.claude/skills/run-report/learnings.md` before anything else. Apply every rule. If two rules conflict, the most recent date wins. Never edit this SKILL.md to record feedback; use `learnings.md` (see "Learning loop").

## 2. Gather the material

Condense by **aggregating**, not by paraphrasing away meaning: group items of the same kind, count them, keep one line per group. Never drop a disagreement between agents, a failed check or an unresolved risk to make the page shorter; those are the most useful lines.

Orchestration sources, in this order:
- agent reports: `node ~/.claude/cockpit/bin/orchestrate.js read <agent>` and the files in the run folder;
- notes and state: `orchestrate status`;
- the work itself: `git log`/`git diff --stat` on the worktree, and the skill or file paths touched.

Other long work: the conversation, the git diff, test and command outputs you ran.

Verify each claim you put on the page against a source (a file exists, a command passed). Report what was verified, not what was intended.

## 3. Page structure (fixed, in this order)

| Section | Content | Cap |
|---|---|---|
| Verdict | 1-3 lines: done / partly done / blocked, and the one thing that matters | 3 lines |
| Changed | Skills created or modified, code, branches. One row each: path or link + one-line what | 8 items, 120 chars each |
| Decisions | Key choices and reasoning, one line each, with the why | 6 items, 140 chars each |
| Verified | What was checked and how (command, test, read-back) | 5 items, 100 chars each |
| Left / waiting on you | Open items, risks, decisions the user must take, each with a recommendation | 5 items, 120 chars each |
| Raw reports | Links or paths to the full agent reports and logs | links only |

Rules:
- Anything beyond a cap goes behind a link to the raw report, never in the page. If a section has nothing, drop it rather than write "none".
- Total target: one or two screens. No section intro sentences, no recap of the request.
- "Left / waiting on you" comes right after the verdict when it contains a blocker or a decision for the user (move it up; say so nowhere, just do it).
- Each Changed row names a real path or URL. No path, no row.

## 4. Visual treatment

Sober and glanceable: a header with the verdict and a state badge, then compact cards or tables, one badge per row (done / changed / verified / blocked / waiting), semantic colours only for state. Light and dark themes, phone-width safe. No walls of text, no emojis as markers, no decorative hero. Follow the `artifact-design` skill for the page contract (title as a 2-4 word name such as "Rapport créations skills", `description`, tokens, theme blocks, gutters, `icon`).

Minimal skeleton to adapt:

```html
<title>Rapport {sujet}</title>
<style>
  :root { --bg:#f6f7f9; --fg:#1b1f27; --muted:#5d6675; --card:#fff; --line:#dde1e8;
          --ok:#1f7a4d; --warn:#9a6700; --bad:#b3261e; --info:#2456a6; }
  /* dark: same tokens, redefined in both dark blocks per artifact-design */
  body { background:var(--bg); color:var(--fg); font:15px/1.45 system-ui,sans-serif;
         padding-block:20px; padding-left:max(16px,env(safe-area-inset-left,0px));
         padding-right:max(16px,env(safe-area-inset-right,0px)); }
  main { max-width:760px; margin:auto; display:grid; gap:14px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
  .row { display:flex; gap:10px; padding:6px 0; border-top:1px solid var(--line); min-width:0; }
  .badge { font-size:12px; padding:1px 8px; border-radius:99px; white-space:nowrap; }
</style>
<main>
  <section><h1>Verdict <span class="badge">terminé</span></h1><p>…3 lignes max…</p></section>
  <section><h2>Changé</h2><div class="row"><code>chemin</code><span>une ligne</span></div></section>
  <section><h2>Décisions</h2>…</section>
  <section><h2>Vérifié</h2>…</section>
  <section><h2>Reste / t'attend</h2>…</section>
  <section><h2>Rapports bruts</h2>…liens…</section>
</main>
```

## 5. Before publishing

Check against the caps and the learnings: count items, trim over-long lines, remove anything the user has said they do not care about. Publish with the Artifact tool, give them the link, and in the chat message add at most 3 lines. Then ask nothing more than: "Dis-moi ce qui était trop long ou inutile, je l'ajoute au skill."

## Learning loop

The skill improves only through the user's reactions to real reports.

- **When**: any reaction to a report, positive or negative ("trop long", "ça je m'en fiche", "mets X en tête", "parfait comme ça").
- **How**: extract the underlying rule, not the raw comment. Ask: "what would I do differently on the next report?" Add it to the right section of `learnings.md` as `- [YYYY-MM-DD] rule — why/feedback: "short original quote"`.
- **Conflicts**: do not stack contradicting lines. Rewrite or delete the older rule; the newest feedback wins. A rule repeated by a second feedback becomes firmer; note `(x2)`.
- **Caps tuning**: if the user says a section is too long or too short, change its cap in `learnings.md` (a rule overriding the table above) rather than editing this file.
- **Hygiene**: keep under ~40 rules; merge duplicates, drop obsolete ones. Tell the user in one line what you recorded. If they say to forget a rule, delete it at once.
- If you cannot write the file, print the entry in a code block for them to save.
