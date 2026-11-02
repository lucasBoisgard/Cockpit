function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};
  if (!match) return meta;
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([\w-]+):\s*(.*)$/);
    if (pair) {
      key = pair[1];
      meta[key] = /^[>|][-+]?$/.test(pair[2]) ? '' : pair[2].replace(/^(["'])(.*)\1$/, '$2');
    } else if (key && /^\s+\S/.test(line)) {
      meta[key] = `${meta[key]} ${line.trim()}`.trim();
    }
  }
  return meta;
}

function uniqueByName(list) {
  const seen = new Set();
  return list.filter((c) => !seen.has(c.name) && seen.add(c.name));
}

module.exports = { parseFrontmatter, uniqueByName };
