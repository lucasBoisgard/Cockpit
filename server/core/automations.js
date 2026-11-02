const { validName } = require('./sessions');

function normalizeAutomation(item, list, newId, now) {
  const name = String(item?.name || '').trim();
  const worktree = String(item?.worktree || '').trim();
  const prompt = String(item?.prompt || '').trim();
  const schedule = item?.schedule || {};
  if (!name || !prompt) return { error: 'Nom et prompt obligatoires.' };
  if (!validName(worktree)) return { error: 'Nom de worktree invalide.' };
  if (schedule.type === 'daily' && !/^\d{2}:\d{2}$/.test(String(schedule.time))) return { error: 'Heure invalide (HH:MM).' };
  if (schedule.type === 'interval' && !(Number(schedule.minutes) >= 10)) return { error: 'Intervalle de 10 minutes minimum.' };
  if (!['daily', 'interval'].includes(schedule.type)) return { error: 'Planification invalide.' };
  const id = item.id && list.some((a) => a.id === item.id) ? item.id : newId;
  const previous = list.find((a) => a.id === id);
  return {
    automation: {
      id,
      name,
      worktree,
      newWorktree: !!item.newWorktree,
      prompt,
      enabled: item.enabled !== false,
      tzOffsetMin: Number.isFinite(Number(item.tzOffsetMin)) ? Number(item.tzOffsetMin) : 0,
      schedule: schedule.type === 'daily' ? { type: 'daily', time: schedule.time, days: (schedule.days || [1, 2, 3, 4, 5]).map(Number).filter((d) => d >= 0 && d <= 6) } : { type: 'interval', minutes: Number(schedule.minutes) },
      createdAt: previous?.createdAt || now,
      lastRun: previous?.lastRun || null,
      lastWorktree: previous?.lastWorktree || null,
      lastOk: previous?.lastOk ?? null,
      lastResult: previous?.lastResult || null,
    },
  };
}

function nextRunOf(a, now = Date.now()) {
  if (!a.enabled) return null;
  if (a.schedule.type === 'interval') return a.lastRun ? Math.max(now, a.lastRun + a.schedule.minutes * 60000) : now;
  const [h, m] = a.schedule.time.split(':').map(Number);
  const local = new Date(now - a.tzOffsetMin * 60000);
  for (let d = 0; d < 8; d++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d, h, m));
    const slot = day.getTime() + a.tzOffsetMin * 60000;
    if (!a.schedule.days.includes(day.getUTCDay())) continue;
    if (slot > now || Math.max(a.lastRun || 0, a.createdAt || 0) < slot) return Math.max(slot, now);
  }
  return null;
}

function automationDue(a, now) {
  if (!a.enabled) return false;
  if (a.schedule.type === 'interval') return !a.lastRun || now - a.lastRun >= a.schedule.minutes * 60000;
  const local = new Date(now - a.tzOffsetMin * 60000);
  const [h, m] = a.schedule.time.split(':').map(Number);
  if (!a.schedule.days.includes(local.getUTCDay())) return false;
  const slot = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) + a.tzOffsetMin * 60000;
  return now >= slot && Math.max(a.lastRun || 0, a.createdAt || 0) < slot;
}

function automationWorktree(a, now) {
  const stamp = new Date(now - a.tzOffsetMin * 60000).toISOString().slice(5, 16).replace(/[-:T]/g, '');
  return a.newWorktree ? `${a.worktree}-${stamp}` : a.worktree;
}

module.exports = { normalizeAutomation, nextRunOf, automationDue, automationWorktree };
