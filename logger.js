// ============== SESSION LOG (with localStorage persistence) ==============
const STORAGE_LIST_KEY = 'ax:sessionList';
const STORAGE_SESSION_PREFIX = 'ax:session:';
const MAX_SESSIONS = 10;

let sessionLogs = [];        // in-memory log of *current* session
let unreadCount = 0;
let drawerOpen = false;
let viewingSessionId = null; // which session is currently displayed in the drawer

// ---------- Helpers ----------
function pad2(n) { return n.toString().padStart(2, '0'); }
function nowTs() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function genSessionId() {
  const d = new Date();
  return `session_${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}
const SESSION_ID = genSessionId();
viewingSessionId = SESSION_ID;

function arrowFor(type) {
  switch (type) {
    case 'in':    return '<<<';
    case 'event': return '>>>';
    case 'error': return '!!!';
    default:      return '>>>';
  }
}

// ---------- localStorage layer ----------
function loadSessionList() {
  try { return JSON.parse(localStorage.getItem(STORAGE_LIST_KEY) || '[]'); }
  catch { return []; }
}

function saveSessionList(list) {
  try { localStorage.setItem(STORAGE_LIST_KEY, JSON.stringify(list)); }
  catch (e) { console.warn('localStorage list save failed:', e); }
}

function loadSessionLogs(id) {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSION_PREFIX + id) || '[]'); }
  catch { return []; }
}

function saveSessionLogs(id, logs) {
  try { localStorage.setItem(STORAGE_SESSION_PREFIX + id, JSON.stringify(logs)); }
  catch (e) { console.warn('localStorage session save failed:', e); }
}

function deleteSessionLogs(id) {
  localStorage.removeItem(STORAGE_SESSION_PREFIX + id);
}

// ---------- Init: register this session, prune old ones ----------
(function initSession() {
  let list = loadSessionList();
  if (!list.includes(SESSION_ID)) list.push(SESSION_ID);
  while (list.length > MAX_SESSIONS) {
    const oldest = list.shift();
    deleteSessionLogs(oldest);
  }
  saveSessionList(list);
})();

// ---------- Rendering ----------
function renderLogLine(entry) {
  const body = document.getElementById('terminalBody');
  const line = document.createElement('div');
  line.className = 'log-line';
  const arrowClass = `log-arrow-${entry.type === 'out' ? 'out' : entry.type}`;
  const textClass = `log-${entry.type}`;
  line.innerHTML =
    `<span class="log-ts">[${entry.ts}]</span>` +
    `<span class="${arrowClass}">${arrowFor(entry.type)}</span>` +
    `<span class="${textClass}">${escapeHtml(entry.message)}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

function renderTerminal(logs) {
  const body = document.getElementById('terminalBody');
  body.innerHTML = '';
  logs.forEach(renderLogLine);
}

function renderSessionList() {
  const container = document.getElementById('sessionsList');
  if (!container) return;
  const list = loadSessionList();
  container.innerHTML = '';
  // newest first
  list.slice().reverse().forEach(id => {
    const chip = document.createElement('div');
    chip.className = 'session-chip';
    if (id === viewingSessionId) chip.classList.add('active');
    if (id === SESSION_ID) chip.classList.add('current');
    const stripped = id.replace('session_', '');
    const [date, time] = stripped.split('_');
    const displayTime = (time || '').replace(/-/g, ':');

    const isLive = id === SESSION_ID;
    chip.innerHTML =
      `<div class="chip-row">` +
        `<span class="chip-time">${displayTime}</span>` +
        (isLive ? `<span class="chip-live">LIVE</span>` : '') +
        (isLive ? '' : `<button class="chip-delete" title="Delete session">×</button>`) +
      `</div>` +
      `<span class="chip-date">${date}</span>`;
    chip.title = `Click to view ${id}`;

    // Click chip body → switch session
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('chip-delete')) return;
      switchSession(id);
    });
    // Click delete → remove session
    const delBtn = chip.querySelector('.chip-delete');
    if (delBtn) {
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteSession(id);
      });
    }
    container.appendChild(chip);
  });
}

function deleteSession(id) {
  if (id === SESSION_ID) return; // never delete the live session

  const list = loadSessionList().filter(x => x !== id);
  saveSessionList(list);
  deleteSessionLogs(id);

  // If we were viewing the deleted session, jump back to current
  if (viewingSessionId === id) {
    viewingSessionId = SESSION_ID;
    renderTerminal(sessionLogs);
    document.getElementById('sessionIdLabel').textContent = `${SESSION_ID} (live)`;
    document.getElementById('sessionLineCount').textContent = sessionLogs.length;
  }
  renderSessionList();
  log(`Deleted session ${id}`, 'event');
}

// ---------- Session switching ----------
function switchSession(id) {
  viewingSessionId = id;
  const logs = id === SESSION_ID ? sessionLogs : loadSessionLogs(id);
  renderTerminal(logs);
  document.getElementById('sessionIdLabel').textContent =
    id === SESSION_ID ? `${id} (live)` : id;
  document.getElementById('sessionLineCount').textContent = logs.length;
  renderSessionList();
}

// ---------- Public log() ----------
function log(message, type = 'out') {
  const ts = nowTs();
  const entry = { ts, type, message };
  sessionLogs.push(entry);
  saveSessionLogs(SESSION_ID, sessionLogs);

  if (viewingSessionId === SESSION_ID) {
    renderLogLine(entry);
    const cnt = document.getElementById('sessionLineCount');
    if (cnt) cnt.textContent = sessionLogs.length;
  }

  if (!drawerOpen) {
    unreadCount++;
    const badge = document.getElementById('logsBadge');
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.classList.add('show');
    document.getElementById('viewLogsBtn').classList.add('has-new');
  }
}

// ---------- Drawer toggle ----------
function openLogs() {
  drawerOpen = true;
  document.getElementById('logsDrawer').classList.add('open');
  document.getElementById('logsBackdrop').classList.add('open');
  unreadCount = 0;
  document.getElementById('logsBadge').classList.remove('show');
  document.getElementById('viewLogsBtn').classList.remove('has-new');
  switchSession(viewingSessionId);
}

function closeLogs() {
  drawerOpen = false;
  document.getElementById('logsDrawer').classList.remove('open');
  document.getElementById('logsBackdrop').classList.remove('open');
}

// ---------- Actions ----------
function clearCurrentSession() {
  sessionLogs = [];
  saveSessionLogs(SESSION_ID, sessionLogs);
  if (viewingSessionId === SESSION_ID) {
    document.getElementById('terminalBody').innerHTML = '';
    document.getElementById('sessionLineCount').textContent = '0';
  }
  unreadCount = 0;
  document.getElementById('logsBadge').classList.remove('show');
  document.getElementById('viewLogsBtn').classList.remove('has-new');
  log('Current session cleared by operator', 'event');
}

function logsToText(logs) {
  return logs.map(e => `[${e.ts}] ${arrowFor(e.type)} ${e.message}`).join('\n') + '\n';
}

function downloadCurrentSession() {
  const id = viewingSessionId;
  const logs = id === SESSION_ID ? sessionLogs : loadSessionLogs(id);
  triggerDownload(logsToText(logs), `${id}.log`);
}

function downloadAllSessions() {
  const list = loadSessionList();
  const parts = list.map(id => {
    const logs = id === SESSION_ID ? sessionLogs : loadSessionLogs(id);
    const header = '='.repeat(60) + '\n' +
                   `SESSION: ${id}\n` +
                   `LINES:   ${logs.length}\n` +
                   '='.repeat(60) + '\n';
    return header + logsToText(logs);
  });
  const stamp = SESSION_ID.replace('session_', '');
  triggerDownload(parts.join('\n'), `auto-examiner_all-sessions_${stamp}.log`);
}

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
