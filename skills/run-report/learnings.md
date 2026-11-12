# Run report learnings

Read before every report. Newest rule wins on conflict. Format: `- [date] rule — why/feedback: "quote or source"`.

## Length and density
- [2026-11-06] Be brief and succinct: one or two screens, never a 1000-line page; the verdict leads, in 3 lines max — why: "Sois bref et succinct. Je ne veux pas d'un fichier indigeste de 1000 lignes moches"
- [2026-11-06] Overflow goes to links to raw reports, never into the page — why: same request
- [2026-10-26] No big text blocks: short headings, one idea per line, paragraphs of 1-2 sentences max — why: "les gros blocs comme ça sont illisibles" (memory feedback_structured_answers)
- [2026-11-04] Condensed means one finding line plus the conclusion; no context paragraph before each item, no jargon-heavy report phrasing, human tone — why: reports and drafts judged too verbose (memory feedback_concise_review_drafts)
- [2026-11-04] Minor points go in a single info line, not one block each — why: PR #13702 report feedback

## Content
- [2026-11-06] Always list skills created or modified and what changed or which reasoning was found, with a path or link for each — why: "me dit les skills créés/modifiés et les modifications apportées ou les raisonnements trouvés"
- [2026-11-06] Every "Changé" line states what the item is before what happened to it: "skill de rôle", "skill", "fichier", "code Cockpit", "commit"… (badge like "skill · créé", "code · mergé") — why: "tu peux aussi spécifier dans ce genre de rapport si on parle d'un skill"
- [2026-11-06] Make the kind of each skill obvious: badge role skills as "rôle" and name the domain skills they load, so a role skill is never mistaken for an existing domain skill — why: "pourquoi pr-reviewer apparaîtrait dans créé ? il existait déjà non ?" then "c'est un skill-rôle pas le skill qui existait, j'avais mal compris"
- [2026-11-06] Say what was verified and how; report failures and agent disagreements plainly instead of smoothing them over — why: faithful reporting; aggregation must not lose meaning
- [2026-11-06] Anything waiting on Lucas appears with a recommendation, and moves up right after the verdict when it blocks — why: he decides, he should not have to hunt for it

## Visual
- [2026-11-06] Sober cards or tables with state badges, no walls of text; light and dark themes — why: "pas de fichier indigeste… moches"; ux-agency learnings favour compact pills and glanceable status
- [2026-11-06] Cockpit-style typed blocks (colour per kind) are a good model for short, typed reporting — why: review-report skill format

## Language
- [2026-08-18] Displayed content in French, always, even mid-technical work — why: memory feedback_speak_french
- [2026-10-15] This SKILL.md, learnings.md and any file kept in a repo or skills folder are in English; French is only for the chat and the page shown to Lucas — why: memory feedback_english_in_codebase
- [2026-11-02] Personal skills live in ~/.claude/skills, never in a repo — why: memory feedback_personal_skills_location
