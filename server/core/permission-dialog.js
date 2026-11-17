// Reading a Claude Code approval dialog from its screen and choosing the key presses that answer it. The usual dialog numbers its
// options with "Yes" first, but some tool confirmations list "No" before "Yes" without numbers, so a fixed key (1 = allow) can
// answer the opposite of what the user clicked. Anything that is not recognized for sure returns null: nothing is ever pressed blindly.

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const FOOTER = /\b(esc|enter|tab|ctrl\+c)\b.*\b(cancel|exit|select|confirm|amend|continue)\b/i;
const POINTER = /^(\s*[❯›]\s+)(\S.*)$/;
// The footer of the live dialog is among the last lines of the screen; an older one in the scrollback is not.
const FOOTER_WINDOW = 6;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// The options of the dialog drawn at the bottom of the screen: [{ label, number, selected }], top to bottom; [] when none is
// recognized: no footer near the bottom, no highlighted option, options not aligned, or numbers that are not 1..n.
function parseOptions(text) {
  const lines = String(text || '').replace(ANSI, '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const filled = lines.map((l, i) => [l, i]).filter(([l]) => l.trim());
  const recent = filled.slice(-FOOTER_WINDOW);
  const footer = [...recent].reverse().find(([l]) => FOOTER.test(l));
  if (!footer) return [];
  let i = footer[1] - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  const rows = [];
  for (; i >= 0; i--) {
    const pointer = lines[i].match(POINTER);
    if (pointer) { rows.unshift({ text: pointer[2], column: pointer[1].length, selected: true }); continue; }
    if (indentOf(lines[i]) < 3) break;
    rows.unshift({ text: lines[i].trim(), column: indentOf(lines[i]), selected: false });
  }
  const pointed = rows.find((r) => r.selected);
  if (!pointed) return [];
  const options = [];
  for (const row of rows) {
    if (row.column > pointed.column) {
      if (!options.length) return [];
      options[options.length - 1].label += ` ${row.text}`;
    } else if (row.column === pointed.column) {
      const numbered = row.text.match(/^(\d+)\.\s+(.*)$/);
      options.push({ label: (numbered ? numbered[2] : row.text).trim(), number: numbered ? Number(numbered[1]) : null, selected: row.selected });
    } else {
      return [];
    }
  }
  const numbers = options.map((o) => o.number);
  if (numbers.some((n) => n !== null) && !numbers.every((n, k) => n === k + 1)) return [];
  return options;
}

const YES = /^yes(\s*\(y\))?$/i;
const NO = /^no(\s*\(n\))?$/i;

// The key presses that choose the exact "Yes" (decision 'allow') or "No" (decision 'deny'). Variants such as "Yes, and don't ask
// again" are never picked: they grant more than one request. null when the dialog is not recognized or shows no such option.
function answerOps(text, decision) {
  const options = parseOptions(text);
  if (options.length < 2) return null;
  const matches = options.map((o) => (decision === 'deny' ? NO : YES).test(o.label));
  if (matches.filter(Boolean).length !== 1) return null;
  const index = matches.indexOf(true);
  const target = options[index];
  if (target.number !== null) return [{ literal: String(target.number) }];
  const current = options.findIndex((o) => o.selected);
  const move = index - current;
  return [...Array.from({ length: Math.abs(move) }, () => ({ key: move > 0 ? 'Down' : 'Up' })), { key: 'Enter' }];
}

module.exports = { parseOptions, answerOps };
