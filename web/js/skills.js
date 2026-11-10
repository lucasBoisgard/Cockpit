const SKILL_SOURCES = {
  local: ['Local', 'Tes skills perso, dans ~/.claude'],
  cockpit: ['Cockpit', 'Installés par le cockpit (liens vers son repo)'],
  repo: ['Projet', 'Versionnés dans le repo'],
  codexLocal: ['GPT · local', 'Skills dans ~/.agents/skills'],
  codexRepo: ['GPT · projet', 'Skills dans .agents/skills'],
  codexLegacy: ['GPT · Codex', 'Skills dans le dossier Codex'],
  synced: ['Claude.ai', 'Synchronisés depuis ton compte claude.ai'],
  plugin: ['Plugin', 'Fournis par un plugin installé'],
};
const SKILL_KINDS = { skill: 'skill', command: 'commande' };

let skillsData = null;
let skillsSelected = null;
let skillsAssist = { sessionId: null, messages: [], busy: false };
const skillsCollapsed = new Set();

function skillSourceLabel(group) {
  const [label, hint] = SKILL_SOURCES[group.source] || [group.source, ''];
  if (group.source === 'repo') return [`${label} · ${state?.repoName || ''}`, hint];
  if (group.plugin) return [`${label} · ${group.plugin}`, hint];
  return [label, hint];
}

function skillMatches(item, filter) {
  return !filter || `${item.name} ${item.description}`.toLowerCase().includes(filter);
}

function skillFolderHtml(folder, key, filter) {
  const folders = folder.folders.map((f) => skillFolderHtml(f, `${key}/${f.name}`, filter)).filter(Boolean);
  const items = folder.items.filter((item) => skillMatches(item, filter)).map((item) => `<button class="skills-item ${item.path === skillsSelected ? 'on' : ''}" data-skill="${esc(item.path)}" title="${esc(item.description)}"><span class="skills-kind ${esc(item.kind)}">${esc(SKILL_KINDS[item.kind] || item.kind)}</span><span class="skills-name">${esc(item.name)}</span></button>`);
  if (!folders.length && !items.length) return '';
  if (folder.name === undefined) return folders.join('') + items.join('');
  const open = filter || !skillsCollapsed.has(key);
  return `<div class="skills-folder"><button class="skills-folder-name" data-skills-toggle="${esc(key)}">${open ? '▾' : '▸'} ${esc(folder.name)}/</button>${open ? `<div class="skills-folder-body">${folders.join('')}${items.join('')}</div>` : ''}</div>`;
}

function renderSkillsTree() {
  if (!skillsData) { $('skills-tree').innerHTML = '<div class="placeholder">Chargement…</div>'; return; }
  const filter = $('skills-filter').value.trim().toLowerCase();
  const html = skillsData.tree.map((group) => {
    const body = skillFolderHtml({ ...group, name: undefined }, group.id, filter);
    if (!body) return '';
    const [label, hint] = skillSourceLabel(group);
    const open = filter || !skillsCollapsed.has(group.id);
    const count = (function count(f) { return f.items.filter((item) => skillMatches(item, filter)).length + f.folders.reduce((n, c) => n + count(c), 0); })(group);
    return `<section class="skills-group"><button class="skills-group-name" data-skills-toggle="${esc(group.id)}" title="${esc(hint)}">${open ? '▾' : '▸'} <b>${esc(label)}</b><span>${count}</span></button>${open ? body : ''}</section>`;
  }).join('');
  $('skills-tree').innerHTML = html || '<div class="placeholder">Aucun skill ne correspond.</div>';
}

async function showSkill(file) {
  skillsSelected = file;
  renderSkillsTree();
  $('skills-detail').innerHTML = '<div class="placeholder">Chargement…</div>';
  const res = await api(`/api/skills/file?path=${encodeURIComponent(file)}`).catch(() => null);
  if (skillsSelected !== file) return;
  const skill = res?.ok ? await res.json().catch(() => null) : null;
  if (!skill) { $('skills-detail').innerHTML = '<div class="placeholder">Skill introuvable.</div>'; return; }
  const group = skillsData.tree.find((g) => g.source === skill.source && (g.plugin || null) === (skill.plugin || null));
  $('skills-detail').innerHTML = `<div class="skills-detail-head">
      <div><span class="skills-kind ${esc(skill.kind)}">${esc(SKILL_KINDS[skill.kind] || skill.kind)}</span> <b>${esc(skill.name)}</b> <span class="skills-source">${esc(skillSourceLabel(group || skill)[0])}</span></div>
      <div class="skills-path"><code>${esc(skill.path)}</code><button class="btn" data-skills-copy="${esc(skill.path)}">Copier le chemin</button><button class="btn" data-skills-reuse>Partir de ce skill</button></div>
      ${skill.description ? `<p class="skills-description">${esc(skill.description)}</p>` : ''}
    </div>
    <article class="reader-doc skills-doc">${richMd(skill.body)}</article>`;
  $('skills-detail').dataset.content = skill.content;
  $('skills-detail').scrollTop = 0;
}

async function loadSkills() {
  const res = await api('/api/skills').catch(() => null);
  skillsData = res?.ok ? await res.json().catch(() => null) : null;
  $('skills-count').textContent = skillsData ? `${skillsData.count} skills et commandes` : 'Liste indisponible';
  if (skillsData) {
    const target = $('skills-target').value || 'local';
    $('skills-target').innerHTML = `<option value="local">Claude · local · ${esc(skillsData.targets.local)}</option><option value="repo">Claude · projet · ${esc(skillsData.targets.repo)}</option><option value="codexLocal">GPT · local · ${esc(skillsData.targets.codexLocal)}</option><option value="codexRepo">GPT · projet · ${esc(skillsData.targets.codexRepo)}</option>`;
    $('skills-target').value = target;
  }
  renderSkillsTree();
}

function setSkillsMode(mode) {
  document.querySelectorAll('#skills-mode [data-skills-mode]').forEach((b) => b.classList.toggle('on', b.dataset.skillsMode === mode));
  $('skills-browse').hidden = mode !== 'browse';
  $('skills-add').hidden = mode !== 'add';
  if (mode === 'add') { checkSkillDraft(); $('skills-content').focus(); }
  else $('skills-filter').focus();
}

function openSkills(mode = 'browse') {
  openPage($('skills-dialog'));
  setSkillsMode(mode);
  loadSkills();
  if (!$('skills-detail').innerHTML) $('skills-detail').innerHTML = '<div class="placeholder">Choisis un skill à gauche pour lire son SKILL.md.</div>';
  renderSkillsChat();
}

function skillFrontmatterName(content) {
  return content.match(/^---\r?\n[\s\S]*?^name:[^\S\n]*["']?([^"'\s][^"'\n]*?)["']?[^\S\n]*$/m)?.[1] || '';
}

function checkSkillDraft() {
  const content = $('skills-content').value;
  const name = $('skills-name').value.trim();
  let problem = '';
  if (!content.trim()) problem = 'Colle un SKILL.md, écris-le, ou demande à l’assistant.';
  else if (!/^---\r?\n[\s\S]*?\r?\n---/.test(content)) problem = 'Il manque l’en-tête YAML entre deux lignes ---.';
  else if (!/^description:/m.test(content.split(/\r?\n---/)[0])) problem = 'L’en-tête doit avoir une description.';
  else if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) problem = 'Nom : minuscules, chiffres et tirets.';
  else if (skillFrontmatterName(content) && skillFrontmatterName(content) !== name) problem = `Le name: de l’en-tête (${skillFrontmatterName(content)}) doit être le nom du skill.`;
  $('skills-check').textContent = problem || 'Prêt à créer.';
  $('skills-check').classList.toggle('ok', !problem);
  $('skills-create').disabled = !!problem;
}

function useSkillDraft(draft) {
  $('skills-content').value = draft;
  const name = skillFrontmatterName(draft);
  if (name) $('skills-name').value = name;
  checkSkillDraft();
  toast('Brouillon mis dans l’éditeur.');
}

function skillReplyText(text, draft) {
  if (!draft) return text;
  return text.replace(/^(`{4,}|~{3,})[\w-]*[^\S\n]*\n([\s\S]*?)\n\1[^\S\n]*$/gm, (block, fence, body) => (body === draft ? '*SKILL.md proposé ci-dessous.*' : block));
}

function skillDraftCard(draft, index) {
  const name = skillFrontmatterName(draft) || 'sans nom';
  const lines = draft.split('\n').length;
  return `<div class="skills-draft"><div class="skills-draft-head"><span class="skills-kind">skill</span><b>${esc(name)}</b><span>${lines} lignes</span></div><pre>${esc(draft.split('\n').slice(0, 12).join('\n'))}${lines > 12 ? '\n…' : ''}</pre><button class="btn primary" data-skills-draft="${index}">Mettre dans l’éditeur</button></div>`;
}

function renderSkillsChat() {
  const messages = skillsAssist.messages.map((m, i) => m.role === 'user'
    ? `<div class="skills-msg user">${escLink(m.text)}</div>`
    : `<div class="skills-msg ${m.error ? 'error' : 'assistant'}">${m.error ? esc(m.text) : `<div class="reader-doc skills-reply">${richMd(skillReplyText(m.text, m.draft))}</div>`}${m.draft ? skillDraftCard(m.draft, i) : ''}</div>`);
  if (skillsAssist.busy) messages.push('<div class="skills-msg assistant pending"><span class="skills-dots"><i></i><i></i><i></i></span> L’assistant réfléchit…</div>');
  $('skills-chat').innerHTML = messages.join('') || '<div class="placeholder">Décris ce que le skill doit faire : quand Claude doit le charger, ce qu’il doit faire, ce qu’il ne doit pas faire. L’assistant propose un SKILL.md complet que tu peux mettre dans l’éditeur.</div>';
  $('skills-chat').scrollTop = $('skills-chat').scrollHeight;
  $('skills-ask-send').disabled = skillsAssist.busy;
}

async function askSkillAssistant() {
  const text = $('skills-ask').value.trim();
  if (!text || skillsAssist.busy) return;
  skillsAssist.messages.push({ role: 'user', text });
  skillsAssist.busy = true;
  $('skills-ask').value = '';
  renderSkillsChat();
  const result = await post('/api/skills/assist', { message: text, draft: $('skills-content').value, sessionId: skillsAssist.sessionId });
  skillsAssist.busy = false;
  if (result.ok) {
    skillsAssist.sessionId = result.data.sessionId || skillsAssist.sessionId;
    skillsAssist.messages.push({ role: 'assistant', text: result.data.reply, draft: result.data.draft });
  } else skillsAssist.messages.push({ role: 'assistant', error: true, text: result.data.error || 'L’assistant n’a pas répondu.' });
  renderSkillsChat();
}

async function createSkillFromEditor() {
  const target = $('skills-target').value;
  const name = $('skills-name').value.trim();
  $('skills-create').disabled = true;
  const content = $('skills-content').value.replace(/^(---\r?\n[\s\S]*?^name:)[^\S\n]*$/m, `$1 ${name}`);
  const result = await post('/api/skills/create', { target, name, content });
  $('skills-create').disabled = false;
  if (!result.ok) { toast(result.data.error || 'Création impossible.', 'error'); return; }
  toast(`Skill « ${name} » créé pour ${target.startsWith('codex') ? 'GPT' : 'Claude'}.`);
  $('skills-content').value = '';
  $('skills-name').value = '';
  delete $('skills-name').dataset.touched;
  await loadSkills();
  setSkillsMode('browse');
  showSkill(result.data.path);
}

$('skills-btn').addEventListener('click', () => openSkills());
$('skills-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-skills-mode]'); if (b) setSkillsMode(b.dataset.skillsMode); });
$('skills-filter').addEventListener('input', renderSkillsTree);
$('skills-tree').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-skills-toggle]');
  if (toggle) { const key = toggle.dataset.skillsToggle; if (skillsCollapsed.has(key)) skillsCollapsed.delete(key); else skillsCollapsed.add(key); renderSkillsTree(); return; }
  const item = e.target.closest('[data-skill]');
  if (item) showSkill(item.dataset.skill);
});
$('skills-detail').addEventListener('click', (e) => {
  const copy = e.target.closest('[data-skills-copy]');
  if (copy) { copyText(copy.dataset.skillsCopy).then(() => toast('Chemin copié.')); return; }
  if (e.target.closest('[data-skills-reuse]')) {
    setSkillsMode('add');
    delete $('skills-name').dataset.touched;
    useSkillDraft(($('skills-detail').dataset.content || '').replace(/^(---\r?\n[\s\S]*?)^name:.*$/m, '$1name: '));
    $('skills-name').value = '';
    checkSkillDraft();
    $('skills-name').focus();
  }
});
$('skills-content').addEventListener('input', () => {
  const name = skillFrontmatterName($('skills-content').value);
  if (name && !$('skills-name').dataset.touched) $('skills-name').value = name;
  checkSkillDraft();
});
$('skills-name').addEventListener('input', () => { $('skills-name').dataset.touched = $('skills-name').value ? '1' : ''; checkSkillDraft(); });
$('skills-create').addEventListener('click', createSkillFromEditor);
$('skills-ask-send').addEventListener('click', askSkillAssistant);
$('skills-ask').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askSkillAssistant(); } });
$('skills-chat').addEventListener('click', (e) => {
  const use = e.target.closest('[data-skills-draft]');
  if (use) { useSkillDraft(skillsAssist.messages[Number(use.dataset.skillsDraft)].draft); return; }
  const code = e.target.closest('[data-copy-code]');
  if (code) copyText(code.parentElement.querySelector('code').textContent).then(() => toast('Code copié.'));
});
$('skills-assist-reset').addEventListener('click', () => { if (!skillsAssist.busy) { skillsAssist = { sessionId: null, messages: [], busy: false }; renderSkillsChat(); } });
