// Loaded in <head> so the chosen theme applies before the first paint. "system" follows the OS setting.
const THEMES = { system: 'Système', light: 'Clair', dark: 'Sombre' };

function currentTheme() {
  try { return THEMES[localStorage.getItem('theme')] ? localStorage.getItem('theme') : 'system'; } catch { return 'system'; }
}

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === theme)));
}

applyTheme(currentTheme());

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-choice]');
  if (!b) return;
  try { localStorage.setItem('theme', b.dataset.themeChoice); } catch {}
  applyTheme(b.dataset.themeChoice);
});
document.addEventListener('DOMContentLoaded', () => applyTheme(currentTheme()));
