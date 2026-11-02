function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

function span(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return `${Math.max(0, Math.round(ms / 1000))} s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function statusAge(s, st) {
  if (st === 'working') return span(Date.now() - (s.turnStartedAt || s.statusSince || s.updatedAt));
  return `il y a ${ago(st === s.status ? s.statusSince || s.updatedAt : s.updatedAt)}`;
}

function workedTime(s, st) {
  return (s?.workedMs || 0) + (st === 'working' ? Date.now() - (s.statusSince || s.updatedAt) : 0);
}

function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
}

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: n >= 1e8 ? 0 : 1 })} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString('fr-FR')} k`;
  return String(n);
}

const fmtUsd = (n) => (n == null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);

if (typeof module !== 'undefined') module.exports = { ago, span, statusAge, workedTime, duration, fmtTokens, fmtUsd };
