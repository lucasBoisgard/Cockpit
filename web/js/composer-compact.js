// Workstation composer: one growing line, the session settings folded into a "⚙ model · effort · mode" pill.
let composerSettingsOpen = false;

(function arrangeComposer() {
  const row = document.querySelector('#composer .composer-row');
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'composer-settings';
  pill.className = 'composer-pill';
  pill.setAttribute('aria-expanded', 'false');
  pill.title = 'Mode, modèle et effort de la session';
  row.prepend(pill);
  $('composer').insertBefore($('composer-note'), row);
})();

const selectedText = (id) => {
  const box = $(id.replace('-select', '-box'));
  const select = $(id);
  return box && !box.hidden && select?.selectedOptions[0] ? select.selectedOptions[0].textContent.trim() : '';
};

function updateComposerPill() {
  const pill = $('composer-settings');
  const parts = [selectedText('model-select'), selectedText('effort-select'), selectedText('mode-select')].filter(Boolean);
  pill.hidden = !parts.length;
  pill.textContent = `⚙ ${parts.join(' · ')}`;
  pill.setAttribute('aria-expanded', String(composerSettingsOpen));
  $('composer').classList.toggle('composer-settings-open', composerSettingsOpen);
}

function autosizeComposer() {
  const input = $('composer-input');
  if (!isWorkstation()) { input.style.height = ''; return; }
  input.style.height = 'auto';
  input.style.height = `${Math.min(220, Math.max(40, input.scrollHeight + 2))}px`;
}

$('composer-settings').addEventListener('click', () => { composerSettingsOpen = !composerSettingsOpen; updateComposerPill(); });
document.addEventListener('click', (e) => {
  if (composerSettingsOpen && !e.target.closest('#composer-settings, .composer-foot')) { composerSettingsOpen = false; updateComposerPill(); }
});
$('composer').addEventListener('change', () => setTimeout(updateComposerPill, 0));
$('composer-input').addEventListener('input', autosizeComposer);
