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

Diagram first: every section leads with a figure (only the one-line verdict comes before its graph). Text is only labels, captions and one-line callouts. The user wants schemas, not paragraphs.

| Section | Lead figure (see section 4) | Text allowed |
|---|---|---|
| Verdict | State badge + one verdict line (it may carry the state, e.g. "partiel : 2 points ouverts"); the orchestration graph or step flow right under it | 1 line |
| Changed | Change map (HTML tree/blocks, badge per kind and state) or before/after of the behaviour | Node ≤3 words; path in the row beside it, or as small text in the caption; max 8 nodes |
| Decisions | Decision table "Retenu / Plutôt que / Pourquoi": one row per choice | Option ≤3 words; why ≤14 words; max 6 |
| Verified | Status grid (checks × OK/KO/non lancé) | Check ≤3 words; the command or source as small text in the row or caption (no tooltips: not on touch); max 8 checks |
| Left / waiting on you | Checklist with owner chips and a recommendation tag | ≤14 words per item; max 5 |
| Raw reports | Links only | Links |

Rules:
- Prose budget for the whole page: one verdict line, then visuals. No paragraph over 2 lines (about 30 words). A section that needs a paragraph needs a better figure, or a link to the raw report.
- Anything beyond a cap goes behind a link to the raw report, never in the page. If a section has nothing, drop it rather than write "none".
- Total target: one or two screens. No section intro sentences, no recap of the request.
- "Left / waiting on you" comes right after the verdict when it contains a blocker or a decision for the user (move it up; say so nowhere, just do it).
- Each Changed node links a real path or URL. No path, no node.

## 4. Visual treatment

Sober and glanceable: a header with the verdict and a state badge, then one `<figure>` (+ short `<figcaption>`) per section, semantic colours only for state. Light and dark themes, phone-width safe. No walls of text, no emojis as markers, no decorative hero. Follow the `artifact-design` skill for the page contract (title as a 2-4 word name such as "Rapport créations skills", `description`, tokens, theme blocks, gutters, `icon`).

### Diagram catalogue

One claim per figure; show the real mechanism, not boxes with names. SVG for the three flow-like types, HTML/CSS (grid or flex, badges, tokens) for the four text-like ones: HTML sizes itself from its content.
- **Orchestration graph** (SVG, Verdict): one labelled lane per phase (phases started together sit on the same row; never file an agent under another phase's lane), agents as nodes (role + state), solid arrows for hand-offs, dashed labelled arrows for loop-backs (`fix → re-review`) and cross-checks (`refutes`). Max 12 nodes: merge same-role agents of one wave into one node (`explorateurs ×4`); a resumed agent has a dashed frame. Label loops and cross-checks only; hand-offs are unlabelled and explained once in a small legend. No agents: the Verdict figure is the steps of the work as a left-to-right flow (step → result, state colour).
- **Timeline of waves** (SVG, optional): only when wall-clock matters and timestamps were gathered; otherwise skip.
- **Decision table** (HTML, Decisions): grid "Retenu / Plutôt que / Pourquoi"; the option taken is a pill with a check and an `--ok` border, the rejected one a pill with a cross, a dashed border and muted text, the why is plain text. Under 700px of container: the two pills side by side, the why under them, no header row.
- **Before / after** (SVG, behaviour changed): two panels, the edge added or removed highlighted.
- **Change map** (HTML, Changed): files or areas grouped by folder, badge "créé / modifié / supprimé", each linked to its path.
- **Status grid** (HTML, Verified): checks as rows, runs or targets as columns, cells OK / KO / non lancé.
- **Checklist with owners** (HTML, Left): one row per item, owner chip (toi / agent / maître), recommendation tag, blocker first.

How to draw (details in `artifact-diagramming`):
- Inline `<svg>` with a `viewBox`, `role="img"`, an `aria-label` of one sentence (the takeaway; details in the figcaption). No external chart library unless a figure truly needs one.
- Two layouts per diagram, both in the same `.fig`: `svg.d-wide` (horizontal, viewBox at most 700 wide, the container-query threshold) and `svg.d-tall` (one column, viewBox 316 wide, for a 360-380px phone). Each SVG gets `style="max-width:<its viewBox width>px"` and stays left-aligned like the text: it may shrink a little, it is never scaled up.
- Write the SVG with a small script (about 40 lines of Node printing strings), never by hand-typed coordinates: node width = 20px padding + label length × ~0.6em (bold) or ~0.56em, one width per column, x positions accumulated from those widths. Shorten or wrap a label rather than let it touch its border. Text 12-13px, ≤3 words per node.
- Sizes that work: wide node 48 high (label line, then dot + state line); tall node 34 high and about 200 wide (dot and label left, state right-aligned); gaps 14-24; lane label 12px above its row; 44px free under a row that carries a loop-back. Tall layout: lanes stacked, a lane sits right above the lane it feeds.
- Calm surfaces: nodes filled with `--node` and a thin `--node-line` border. State = a small dot or a coloured border plus a word (`OK`, `12 constats`), never a saturated fill, never colour alone. Colours only as `var(--token)`, no hex or named colour in an SVG.
- Arrows: short, straight between neighbours, in `--edge`, never across a node or a label. Loop-backs and resumptions: dashed, same quiet colour, leaving the bottom (wide) or the right side (tall) of the source, running outside the row and entering the target on that same side, short label on the run; a redone node has a dashed frame. Explain the encodings once in an HTML legend under the figure.
- Arrowheads via `<marker>`; no `<script>`, `<style>` or `<foreignObject>` inside the SVG.

Minimal skeleton to adapt (a hub page is served as is: keep the doctype, charset and viewport; the first element is a back link to the index, with the right number of `../` for a page in a folder):

```html
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport {sujet}</title>
<style>
  :root { --bg:#f6f7f9; --fg:#1b1f27; --muted:#5d6675; --card:#fff; --line:#dde1e8; --node:#f7f9fb; --node-line:#cbd2db; --edge:#7a8593;
          --ok:#1f7a4d; --warn:#9a6700; --bad:#b3261e; --info:#2456a6; --on-state:#fff; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme:dark;
    --bg:#14171c; --fg:#e8ebf0; --muted:#9aa3b2; --card:#1c2027; --line:#2c323c; --node:#212833; --node-line:#3b4654; --edge:#8590a0;
    --ok:#4cc38a; --warn:#e0a93b; --bad:#f2766d; --info:#6ea2f0; --on-state:#10141a; } }
  :root[data-theme="dark"] { color-scheme:dark;
    --bg:#14171c; --fg:#e8ebf0; --muted:#9aa3b2; --card:#1c2027; --line:#2c323c; --node:#212833; --node-line:#3b4654; --edge:#8590a0;
    --ok:#4cc38a; --warn:#e0a93b; --bad:#f2766d; --info:#6ea2f0; --on-state:#10141a; }
  body { background:var(--bg); color:var(--fg); font:15px/1.45 system-ui,sans-serif;
         padding-block:20px; padding-left:max(16px,env(safe-area-inset-left,0px));
         padding-right:max(16px,env(safe-area-inset-right,0px)); }
  main { max-width:760px; margin:auto; display:grid; gap:14px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px 14px; min-width:0; } figure { margin:8px 0 0; min-width:0; }
  .row { display:flex; gap:10px; padding:6px 0; border-top:1px solid var(--line); min-width:0; }
  .badge { font-size:12px; padding:1px 8px; border-radius:99px; white-space:nowrap; }
  .fig { container-type:inline-size; overflow-x:auto; } .fig svg { display:block; width:100%; height:auto; }
  .fig .d-wide { display:none; } @container (min-width:700px) { .fig .d-wide { display:block; } .fig .d-tall { display:none; } }
  .n { fill:var(--node); stroke:var(--node-line); } .n-warn { stroke:var(--warn); } .n-redo { fill:none; stroke-dasharray:4 3; }
  .t { fill:var(--fg); font:600 13px system-ui; } .s { fill:var(--muted); font:12px system-ui; } .s-ok { fill:var(--ok); }
  .a { stroke:var(--edge); fill:none; marker-end:url(#ar); } .a-back { stroke-dasharray:4 4; } .ah { fill:var(--edge); }
  .dec { display:grid; grid-template-columns:auto auto 1fr; gap:8px 12px; align-items:center; font-size:13px; } .dec b, .dec s { justify-self:start; padding:5px 10px; border-radius:8px; }
  .dec b { border:1px solid var(--ok); } .dec s { border:1px dashed var(--node-line); color:var(--muted); text-decoration:none; } .dec small { color:var(--muted); }
  @container (max-width:699px) { .dec { grid-template-columns:auto 1fr; } .dec small { display:none; } .dec span { grid-column:1/-1; margin-bottom:8px; } }
</style>
<a href="index.html">← Rapports</a>
<main>
  <section><h1>Verdict <span class="badge">terminé</span></h1><p>…une ligne…</p>
    <figure class="fig"><svg class="d-wide" style="max-width:700px" viewBox="0 0 700 200" role="img" aria-label="…">
      <defs><marker id="ar" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto"><path class="ah" d="M0 0L7 3.5L0 7z"/></marker></defs>
      <g class="nd"><rect class="n" x="1" y="24" width="114" height="48" rx="8"/><text class="t" x="11" y="44">explorateurs</text>
      <circle fill="var(--ok)" cx="15" cy="57" r="3.5"/><text class="s s-ok" x="24" y="61">×4 · OK</text></g><path class="a" d="M117 48H137"/>…</svg>
      <svg class="d-tall" style="max-width:316px" viewBox="0 0 316 420" role="img" aria-label="…">…same facts, one column…</svg><figcaption>…legend…</figcaption></figure></section>
  <section><h2>Changé</h2><figure>…carte des changements (HTML)…</figure></section>
  <section><h2>Décisions</h2><figure class="fig"><div class="dec"><small>Retenu</small><small>Plutôt que</small><small>Pourquoi</small><b>✓ fan-out à plat</b><s>✕ sous-orch. partout</s><span>…pourquoi…</span>…</div></figure></section>
  <section><h2>Vérifié</h2><figure>…grille de statuts (HTML)…</figure></section>
  <section><h2>Reste / t'attend</h2>…checklist avec propriétaires (HTML)…</section>
  <section><h2>Rapports bruts</h2>…liens…</section>
</main>
```

Self-check before publishing, in addition to the caps: every section except Raw reports leads with a figure (the Verdict line may precede its graph); ≤60 words of prose outside figures, tables and checklists, no paragraph over 30 words; each SVG has `role="img"`, `aria-label`, a figcaption and ≤12 nodes; every KO, disagreement and open risk is drawn in `--bad`/`--warn` (never dropped to keep a figure clean); no hex or named colour inside an SVG (`var(--token)` only).

Visual check, mandatory when the page has an SVG: `node check-visual.js <page.html> <output dir>` (the script next to this file; it needs `playwright-core`, see its header).
- It captures 360/768/1280 in light and dark with a Chromium already on the machine and checks labels inside their nodes, text ≥11px, scale 0.85-1, no sideways scroll.
- Exit 1: read the captures, fix, re-run once; list in the report whatever still fails. Exit 2: not run, say so in the report.
- Nodes are rounded `rect`s and label backgrounds plain ones: the script tells them apart that way.

## 5. Before publishing

Check against the caps and the learnings: count items, trim over-long lines, remove anything the user has said they do not care about. Then hand the page to the hub (section 6). In the chat message give the link and add at most 3 lines. Then ask nothing more than: "Dis-moi ce qui était trop long ou inutile, je l'ajoute au skill."

## 6. Publish into the hub

Every new artifact goes into ONE hub artifact, the one named in house rule H14 (default title "Cockpit — Rapports", em dash U+2014, copied verbatim). Never create a standalone artifact for a report unless the user asks. The hub is private: do not share it. It may also hold link cards to existing standalone artifacts. This section is the single source: other skills point here.

- **Who**: whoever holds the Artifact tool publishes (solo session: you; orchestration: the master, who only lists, reads and publishes). Writers produce files and never publish.
- **Writer**: write the page as one self-contained file `pages/<yyyy-mm-dd>-<slug>.html` (own doctype, charset, viewport, tokens, back link to `index.html`, or `../../index.html` from a page inside a folder; a folder `pages/<yyyy-mm-dd>-<slug>/` only for several pages). Write under the run directory or the scratchpad. Update `index.html` from the version the master read, or create it from a minimal template when the hub does not exist yet (doctype, charset, viewport, title, tokens in light and dark, a heading, a list of cards): add one card on top (date, project or ticket, kind badge such as rapport de run, maquettes UX, audit d'archi, one-line verdict, link to the page), delete nothing. Keep cards light (no inline SVG). Load `artifact-design` before writing the index.
- **Master**: `list` with `limit: 200` (paginate) and find the exact title; with two matches take the most recently updated and tell the user; none: the writer creates `index.html` from the template, you publish it as `file_path` without `url` (first publish: `quickstart` intent `other`, `icon` `report`, one-sentence `description`; later publishes omit `icon`). Otherwise `read` the hub into a file for the writer. Then publish the SAME `url` with `file_path` = the updated `index.html` and `files` = only the new pages (untouched files are kept). Pin only if the user asks.
- **Index**: every card shows its creation date and its last-modified date (unknown = "inconnu", never invented); inside each group, cards are sorted by last-modified date, most recent first.
- **Conflict**: re-read the hub, have the writer merge the card and page into the newer `index.html`, publish again. Never use `force`.
- **Limits**: 255 files per publish, 511 per version. Past about 400 files, move the oldest pages into a second hub "<title> — Archives <yyyy>" linked from the index.
- Artifacts that are not reports (an app, a live dashboard the user reopens alone) stay separate only when the user asks.

## Learning loop

The skill improves only through the user's reactions to real reports.

- **When**: any reaction to a report, positive or negative ("trop long", "ça je m'en fiche", "mets X en tête", "parfait comme ça").
- **How**: extract the underlying rule, not the raw comment. Ask: "what would I do differently on the next report?" Add it to the right section of `learnings.md` as `- [YYYY-MM-DD] rule — why/feedback: "short original quote"`.
- **Conflicts**: do not stack contradicting lines. Rewrite or delete the older rule; the newest feedback wins. A rule repeated by a second feedback becomes firmer; note `(x2)`.
- **Caps tuning**: if the user says a section is too long or too short, change its cap in `learnings.md` (a rule overriding the table above) rather than editing this file.
- **Hygiene**: keep under ~40 rules; merge duplicates, drop obsolete ones. Tell the user in one line what you recorded. If they say to forget a rule, delete it at once.
- If you cannot write the file, print the entry in a code block for them to save.
