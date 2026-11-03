const MODELS = [
  ['default', 'Par défaut'],
  ['opus', 'Opus'],
  ['opus[1m]', 'Opus · 1M'],
  ['sonnet', 'Sonnet'],
  ['sonnet[1m]', 'Sonnet · 1M'],
  ['haiku', 'Haiku'],
  ['fable', 'Fable'],
];
const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = [
  ['auto', 'Auto'],
  ['low', 'Bas'],
  ['medium', 'Moyen'],
  ['high', 'Élevé'],
  ['xhigh', 'Très élevé'],
  ['max', 'Max'],
];

function modelOption(modelId, label) {
  const text = String(modelId || label || '').toLowerCase();
  const family = MODEL_FAMILIES.find((f) => text.includes(f));
  if (!family) return null;
  const long = `${family}[1m]`;
  return /\[1m\]|1m context/.test(text) && MODELS.some(([id]) => id === long) ? long : family;
}

function effortOption(level) {
  const value = String(level || '').toLowerCase();
  return EFFORTS.some(([id]) => id === value) ? value : null;
}

function settingChoice(reported, raw, usageAt, pending, neutral, now) {
  const seen = usageAt > pending?.at;
  const settled = !pending || now - pending.at > (pending.queued ? 30 * 60000 : 5 * 60000) || (seen && (pending.value === neutral || reported === pending.value));
  if (!settled) return pending.value;
  if (reported) return reported;
  return raw ? `other:${raw}` : '';
}

const modelChoice = (usage, pending, now) => settingChoice(modelOption(usage?.modelId, usage?.model), usage?.modelId || usage?.model, usage?.at, pending, 'default', now);
const effortChoice = (usage, pending, now) => settingChoice(effortOption(usage?.effort), usage?.effort, usage?.at, pending, 'auto', now);

if (typeof module !== 'undefined') module.exports = { MODELS, EFFORTS, modelOption, effortOption, modelChoice, effortChoice };
