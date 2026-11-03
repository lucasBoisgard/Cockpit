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

function modelOption(modelId, label) {
  const text = String(modelId || label || '').toLowerCase();
  const family = MODEL_FAMILIES.find((f) => text.includes(f));
  if (!family) return null;
  const long = `${family}[1m]`;
  return /\[1m\]|1m context/.test(text) && MODELS.some(([id]) => id === long) ? long : family;
}

function modelChoice(usage, pending, now) {
  const reported = modelOption(usage?.modelId, usage?.model);
  const seen = usage?.at > pending?.at;
  const settled = !pending || now - pending.at > (pending.queued ? 30 * 60000 : 5 * 60000) || (seen && (pending.value === 'default' || reported === pending.value));
  if (!settled) return pending.value;
  if (reported) return reported;
  return usage?.modelId || usage?.model ? `other:${usage.modelId || usage.model}` : '';
}

if (typeof module !== 'undefined') module.exports = { MODELS, modelOption, modelChoice };
