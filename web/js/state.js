const STATUS = {
  needs_input: { label: 'Attend ta réponse', rank: 0 },
  working: { label: 'En cours', rank: 1 },
  done: { label: 'Terminé', rank: 2 },
  idle: { label: 'Session ouverte', rank: 3 },
  ended: { label: 'Session fermée', rank: 4 },
  none: { label: 'Pas de session', rank: 5 },
};
const SHELL = 'shell';
// Keys that answer an approval prompt, per provider. The server's provider definitions are the source
// (loaded at boot from /api/providers); this is the fallback until they arrive.
const PROVIDER_KEYS = { claude: { allow: { literal: '1' }, always: { literal: '2' }, deny: { literal: '3' } }, codex: { allow: { literal: 'y' }, always: { literal: 'a' }, deny: { key: 'Escape' } } };
api('/api/providers').then((r) => (r.ok ? r.json() : null)).then((p) => { for (const [id, v] of Object.entries(p || {})) if (v.keys) PROVIDER_KEYS[id] = v.keys; }).catch(() => {});
const keysOf = (s) => PROVIDER_KEYS[s?.provider] || PROVIDER_KEYS.claude;
const isGpt = (s) => s?.provider === 'codex';
const USAGE = 'usage';
const APP = 'app';

let state = null;
let filter = localGet('filter') || 'active';
let tab = localGet('tab') || 'chat';
let selected = null;
let selectedFile = null;
let chatSession = null;
let chatSignature = null;
let chatBarSignature = null;
let pendingSelect = null;
let pendingParallel = null;
let usageData = null;
const knownBranches = new Map();
const branchChanges = new Map();
const BRANCH_CHANGE_MS = 2 * 60 * 1000;
let closing = null;
let pendingOps = [];
let screenLoading = false;
let screenKey = '';
let screenLast = '';
let flushTimer = null;
let order = localGet('order') || 'fixed';
const pins = new Set(parseJson(localGet('pins'), []));
let selecting = false;
const picked = new Set();
let focusIndex = -1;
let lastSeenEvent = Number(localGet('lastSeenEvent') || 0);
let eventsBootstrapped = false;
let since = null;
let sinceFiles = null;
let ticket = null;
let changesRepo = null;
let fileFilter = '';
let changesWide = localGet('changesWide') === '1';
const collapsedDirs = new Set();
const reviewComments = new Map();
let lastDiffText = '';
let delegateParent = null;
let editingAutomation = null;
let paletteItems = [];
let paletteIndex = 0;
let checksLoadedAt = 0;
let archivesOpen = false;
const openPeeks = new Set();
let chatItems = [];
let chatLane = 'conversation';
let reportBlocks = [];
let faviconColor = null;
let historyTimer = null;
let cleanupRows = [];

function liveSessions(wt) {
  return wt.sessions.filter((s) => s.live);
}

const primarySession = (wt) => pickPrimary(shownSessions(wt));

function sessionStatus(wt) {
  const s = primarySession(wt);
  if (!s) return 'none';
  if (backgroundOnly(s)) return 'working';
  return s.status || 'idle';
}

function isActive(wt) {
  const st = sessionStatus(wt);
  return wt.files.length > 0 || wt.ahead > 0 || ['needs_input', 'working', 'done'].includes(st) || wt.sessions.some((s) => s.live);
}

function sorted(list) {
  return [...list].sort((a, b) => (b.name === 'main') - (a.name === 'main') || a.name.localeCompare(b.name, 'fr', { numeric: true }));
}

const currentWt = () => (selected && selected !== SHELL ? state?.worktrees.find((w) => w.path === selected) : null);
const currentSession = () => currentWt()?.sessions.find((s) => s.sessionId === chatSession) || null;

const lastActivity = (wt) => Math.max(...shownSessions(wt).map((s) => s.updatedAt || 0), wt.lastCommit?.at || 0);
const liveSession = (wt) => (liveSessions(wt).length ? primarySession(wt) : null);
const isBase = (wt) => wt.mainCheckout || !wt.branch || wt.branch === (wt.baseBranch || state.baseBranch);
