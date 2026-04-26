// ===========================================================================
// logger.js — persistent session log with localStorage backing
//
// Each page load opens a new "session" identified by a timestamp. Every log()
// call is appended both to the in-memory array (for the current session) and
// persisted to localStorage so it survives reloads. The slide-over drawer in
// the UI can switch between sessions, download them, or delete them.
//
// localStorage layout:
//   ax:sessionList            → JSON array of session IDs (oldest → newest)
//   ax:session:<sessionId>    → JSON array of {ts, type, message} entries
//
// Cap: MAX_SESSIONS sessions retained — oldest auto-pruned on new session start.
// ===========================================================================

const STORAGE_LIST_KEY = 'ax:sessionList';
const STORAGE_SESSION_PREFIX = 'ax:session:';
const MAX_SESSIONS = 10;          // older sessions get evicted when this is exceeded

let sessionLogs = [];             // current page session's log entries (in-memory mirror)
let unreadCount = 0;              // counts entries that arrived while the drawer was closed
let drawerOpen = false;           // true while the slide-over panel is visible
let viewingSessionId = null;      // which session's logs the drawer is currently showing

// ---------- Time / ID helpers ----------
function pad2(n) { return n.toString().padStart(2, '0'); }
function nowTs() {                // local HH:MM:SS for the visible log line
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Generate a unique session ID: session_YYYY-MM-DD_HH-mm-ss
function genSessionId() {
  const d = new Date();
  return `session_${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}
const SESSION_ID = genSessionId();
viewingSessionId = SESSION_ID;    // start by viewing the live session

// Map each log type to its prefix glyph (also used in the downloaded .log files).
function arrowFor(type) {
  switch (type) {
    case 'in':    return '<<<';   // incoming response from server / LLM
    case 'event': return '>>>';   // notable event / state transition
    case 'error': return '!!!';   // anything that broke
    default:      return '>>>';   // outbound action by the dashboard
  }
}

// ---------- localStorage CRUD ----------
function loadSessionList() {
  try { return JSON.parse(localStorage.getItem(STORAGE_LIST_KEY) || '[]'); }
  catch { return []; }            // fall back to empty list if JSON is corrupt
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

// ---------- One-time init: register this session and prune the oldest if over cap ----------
(function initSession() {
  let list = loadSessionList();
  if (!list.includes(SESSION_ID)) list.push(SESSION_ID);
  while (list.length > MAX_SESSIONS) {
    const oldest = list.shift();
    deleteSessionLogs(oldest);    // free the storage slot too
  }
  saveSessionList(list);
})();

// ---------- DOM rendering ----------
// Append one log entry to the visible terminal body.
function renderLogLine(entry) {
  const body = document.getElementById('terminalBody');
  const line = document.createElement('div');
  line.className = 'log-line';
  // 'out' has its own arrow class; the rest follow the type name directly
  const arrowClass = `log-arrow-${entry.type === 'out' ? 'out' : entry.type}`;
  const textClass = `log-${entry.type}`;
  line.innerHTML =
    `<span class="log-ts">[${entry.ts}]</span>` +
    `<span class="${arrowClass}">${arrowFor(entry.type)}</span>` +
    `<span class="${textClass}">${escapeHtml(entry.message)}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;   // auto-scroll to bottom
}

// Replace the entire terminal body with a fresh render of `logs`.
function renderTerminal(logs) {
  const body = document.getElementById('terminalBody');
  body.innerHTML = '';
  logs.forEach(renderLogLine);
}

// Render the horizontal session-chip strip (newest first). Each chip shows
// the time, date, and optional LIVE badge. Non-live chips get a delete (×).
function renderSessionList() {
  const container = document.getElementById('sessionsList');
  if (!container) return;
  const list = loadSessionList();
  container.innerHTML = '';

  list.slice().reverse().forEach(id => {
    const chip = document.createElement('div');
    chip.className = 'session-chip';
    if (id === viewingSessionId) chip.classList.add('active');
    if (id === SESSION_ID) chip.classList.add('current');

    // session_2026-04-25_14-23-45 → date "2026-04-25", time "14:23:45"
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

    // Click chip body → switch session (but ignore clicks on the delete button)
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('chip-delete')) return;
      switchSession(id);
    });
    // Delete button → remove this session entirely
    const delBtn = chip.querySelector('.chip-delete');
    if (delBtn) {
      delBtn.addEventListener('click', e => {
        e.stopPropagation();      // don't trigger the parent chip's click handler
        deleteSession(id);
      });
    }
    container.appendChild(chip);
  });
}

// Permanently delete a session from localStorage and the chip list.
// The currently live session is protected — we never delete the in-progress log.
function deleteSession(id) {
  if (id === SESSION_ID) return;

  const list = loadSessionList().filter(x => x !== id);
  saveSessionList(list);
  deleteSessionLogs(id);

  // If we were viewing the deleted session, snap back to live
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
// Replace the visible terminal contents with the chosen session's logs.
function switchSession(id) {
  viewingSessionId = id;
  // Live session reads from in-memory; past sessions read from localStorage
  const logs = id === SESSION_ID ? sessionLogs : loadSessionLogs(id);
  renderTerminal(logs);
  document.getElementById('sessionIdLabel').textContent =
    id === SESSION_ID ? `${id} (live)` : id;
  document.getElementById('sessionLineCount').textContent = logs.length;
  renderSessionList();
}

// ---------- Public API: log() ----------
// Single entry-point used by every other module. Pushes to in-memory + storage,
// optionally renders if the live session is being viewed, and bumps the unread
// badge on the LOGS button when the drawer is closed.
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

  // Drawer closed → flash the LOGS button + badge so the user knows there's activity
  if (!drawerOpen) {
    unreadCount++;
    const badge = document.getElementById('logsBadge');
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.classList.add('show');
    document.getElementById('viewLogsBtn').classList.add('has-new');
  }
}

// ---------- Drawer open / close ----------
function openLogs() {
  drawerOpen = true;
  document.getElementById('logsDrawer').classList.add('open');
  document.getElementById('logsBackdrop').classList.add('open');
  // Clear unread state on open
  unreadCount = 0;
  document.getElementById('logsBadge').classList.remove('show');
  document.getElementById('viewLogsBtn').classList.remove('has-new');
  switchSession(viewingSessionId);   // refresh the visible session
}

function closeLogs() {
  drawerOpen = false;
  document.getElementById('logsDrawer').classList.remove('open');
  document.getElementById('logsBackdrop').classList.remove('open');
}

// ---------- Action buttons (Clear / Download Session / Download All) ----------
// Wipe the live session in place — leaves past sessions untouched.
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

// Format an array of entries as plain-text log lines for download.
function logsToText(logs) {
  return logs.map(e => `[${e.ts}] ${arrowFor(e.type)} ${e.message}`).join('\n') + '\n';
}

// Download whichever session is currently viewed.
function downloadCurrentSession() {
  const id = viewingSessionId;
  const logs = id === SESSION_ID ? sessionLogs : loadSessionLogs(id);
  triggerDownload(logsToText(logs), `${id}.log`);
}

// Combine every stored session into one .log file with banner separators.
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

// Build a Blob and trigger a file download via a hidden <a>.
function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);   // release the blob URL once the click fires
}
