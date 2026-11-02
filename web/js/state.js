const STATUS = {
  needs_input: { label: 'Attend ta réponse', rank: 0 },
  working: { label: 'En cours', rank: 1 },
  done: { label: 'Terminé', rank: 2 },
  idle: { label: 'Session ouverte', rank: 3 },
  ended: { label: 'Session fermée', rank: 4 },
  none: { label: 'Pas de session', rank: 5 },
};
const SHELL = 'shell';
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
let reportBlocks = [];
let faviconColor = null;
let historyTimer = null;
let cleanupRows = [];

function sessionStatus(wt) {
  const s = wt.sessions[0];
  if (!s) return 'none';
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

const lastActivity = (wt) => Math.max(wt.sessions[0]?.updatedAt || 0, wt.lastCommit?.at || 0);
const liveSession = (wt) => wt.sessions.find((s) => s.live) || null;
const isBase = (wt) => wt.name === 'main' || !wt.branch || wt.branch === state.baseBranch;
