// Flags of the orchestrate command line: `--name value`, repeatable `--skill` and `--verifies`, boolean `--isolated`
// and `--explore`, and `--info`, which takes the message after it or, at the end of the line, stands alone.
const REPEATED = { skill: 'skills', verifies: 'verifies' };
const BOOLEAN = ['isolated', 'explore'];
const OPTIONAL_VALUE = ['info'];

function parseFlags(args) {
  const flags = { skills: [], verifies: [] };
  const rest = [];
  const errors = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const name = key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (BOOLEAN.includes(key)) flags[key] = true;
    else if (OPTIONAL_VALUE.includes(key)) flags[name] = i + 1 < args.length ? args[++i] : true;
    else if (i + 1 >= args.length) errors.push(`Valeur manquante pour --${key}.`);
    else if (REPEATED[key]) flags[REPEATED[key]].push(args[++i]);
    else flags[name] = args[++i];
  }
  return { flags, rest, errors };
}

module.exports = { parseFlags };
