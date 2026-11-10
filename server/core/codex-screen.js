// Codex prompts that block a session before its hooks run (trusting the folder, reviewing hooks, any
// numbered choice), read from its terminal screen, without I/O. The cockpit shows them and relays the
// user's choice with arrow keys and Enter: the decision is made and saved by Codex itself.

const OPTION_RE = /^\s*([›>❯])?\s*(\d{1,2})\.\s+(.+?)\s*$/;

function parseCodexPrompt(screen) {
  const lines = String(screen || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const firstOption = lines.findIndex((l) => OPTION_RE.test(l));
  if (firstOption < 0) return null;
  const options = [];
  let selected = null;
  for (let i = firstOption; i < lines.length; i++) {
    const m = lines[i].match(OPTION_RE);
    if (!m) {
      if (lines[i].trim() && options.length) break;
      continue;
    }
    const n = Number(m[2]);
    if (m[1]) selected = n;
    options.push({ n, label: m[3] });
  }
  if (options.length < 2) return null;
  const before = lines.slice(Math.max(0, firstOption - 12), firstOption).map((l) => l.trim()).filter(Boolean);
  const text = before.join('\n');
  const kind = /trust this folder/i.test(text) ? 'folder' : /hook/i.test(text) ? 'hooks' : 'prompt';
  return { kind, title: before[0] || '', text, options, selected: selected ?? options[0].n };
}

// Keys that move the selection from the current option to the chosen one, then confirm it.
function choiceKeys(prompt, n) {
  const from = prompt.options.findIndex((o) => o.n === prompt.selected);
  const to = prompt.options.findIndex((o) => o.n === Number(n));
  if (from < 0 || to < 0) return null;
  const move = to - from;
  return [...Array(Math.abs(move)).fill({ key: move > 0 ? 'Down' : 'Up' }), { key: 'Enter' }];
}

function activeChoiceKeys(screen, n, label) {
  const prompt = parseCodexPrompt(screen);
  if (!prompt || !/^\s*[›>❯]\s*\d{1,2}\.\s+/m.test(screen)) return null;
  if (!label || !prompt.options.some((o) => o.n === Number(n) && o.label.trim().startsWith(String(label).trim()))) return null;
  return choiceKeys(prompt, n);
}

function permissionChoiceKeys(screen, decision) {
  const prompt = parseCodexPrompt(screen);
  if (!prompt || !/^\s*[›>❯]\s*\d{1,2}\.\s+/m.test(screen)) return null;
  const matches = prompt.options.filter((o) => {
    const text = o.label.trim().toLowerCase();
    const yes = /^(yes|allow|approve)\b/.test(text);
    const always = /always|don't ask|do not ask|remember|for (?:the )?(?:session|future)/.test(text);
    if (decision === 'allow') return /^(?:yes(?:,? (?:proceed|allow once|approve once))?|allow once|approve once)[.!]?$/.test(text);
    if (decision === 'always') return yes && always;
    if (decision === 'deny') return /^(no|deny|reject|cancel)\b/.test(text);
    return false;
  });
  return matches.length === 1 ? choiceKeys(prompt, matches[0].n) : null;
}

module.exports = { parseCodexPrompt, choiceKeys, activeChoiceKeys, permissionChoiceKeys };
