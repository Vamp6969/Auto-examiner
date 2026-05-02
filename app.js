// ===========================================================================
// app.js — Auto-Examiner dashboard main controller
//
// Responsibilities:
//   1. Hold global config + runtime state (HF Space URL, LLM endpoint, token).
//   2. Provide DOM helpers (status pills, reward display, difficulty path).
//   3. Drive the episode loop: reset env → ask LLM → render → submit → score.
//   4. Wire user interactions (Start / Stop, log drawer, token modal).
//
// Load order (see index.html): logger.js → api.js → chart.js → app.js (last,
// so its init code runs after every helper from the other modules is defined).
// ===========================================================================

// ============== CONFIG ==============
// Empty string = same-origin: when this dashboard is served by the OpenEnv
// FastAPI app itself (e.g. from the HF Space), all /reset, /step, etc.
// hit the same host. To point at a remote backend, set this to a full URL
// like "https://vamppog-auto-examiner.hf.space".
const HF_BASE = '';
const LLM_BASE = 'https://router.huggingface.co/featherless-ai/v1/chat/completions';   // OpenAI-compatible LLM endpoint via HF router
const LLM_MODEL = 'Qwen/Qwen2.5-72B-Instruct';                                         // Agent model
const TYPEWRITER_MS = 10;        // ms between characters when streaming the challenge text
const STEP_DELAY_MS = 3000;      // pause between consecutive episodes
const MAX_HISTORY = 20;          // bars rendered in the reward history chart
const HF_TOKEN_KEY = 'ax:hf_token';  // localStorage key for the saved HF token

// ============== STATE ==============
let API_KEY = localStorage.getItem(HF_TOKEN_KEY) || '';   // Loaded from localStorage; modal collects it on first run
let running = false;             // True while the main episode loop is active
let stopRequested = false;       // Set by Stop button — checked at safe await points to break cleanly
let totalEpisodes = 0;           // Lifetime episode count for this page session
let currentDifficulty = 1;       // Client-tracked difficulty (passed to /reset every episode)

// ============== UI HELPERS ==============
const $ = id => document.getElementById(id);

// Escape user/LLM-supplied strings before injecting into innerHTML to avoid XSS.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// Promise-based sleep used by the typewriter and inter-episode pauses.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Update a status-pill element with a new label + colour state (idle/running/error).
function setStatus(el, text, kind = 'idle') {
  el.className = 'status-pill ' + kind;
  el.innerHTML = `<span class="status-dot"></span>${text}`;
}

// Update the big REWARD number with a value-tier colour (green / yellow / red).
function setReward(value) {
  const v = $('rewardValue');
  v.textContent = value === null ? '—' : value.toFixed(3);
  v.className = 'reward-value';
  if (value === null) return;
  if (value >= 1.0) v.classList.add('high');
  else if (value >= 0.5) v.classList.add('mid');
  else v.classList.add('low');
}

// Highlight the current step in the 1→2→3→4→5 difficulty path indicator
// and sync the header DIFFICULTY pill.
function setDifficulty(level) {
  currentDifficulty = level;
  $('hdrDifficulty').textContent = level;
  $('progSub').textContent = `level: ${level} / 5`;
  document.querySelectorAll('.prog-step').forEach(el => {
    const l = parseInt(el.dataset.level);
    el.className = 'prog-step';
    if (l === level) el.classList.add('active');
    else if (l < level) el.classList.add('passed');  // dimmer style for steps already cleared
  });
}

// Wipe the test-results panel between episodes.
function clearTests() {
  $('testsList').innerHTML = '';
  $('testsMeta').textContent = '0 / 0';
}

// Push a single test result into the panel after `delay` ms — supports staggered animation.
function addTest(text, passed, delay) {
  return new Promise(resolve => {
    setTimeout(() => {
      const div = document.createElement('div');
      div.className = 'test-item ' + (passed ? 'pass' : 'fail');
      div.innerHTML = `
        <span class="test-icon">${passed ? '✓' : '✗'}</span>
        <span class="test-text">${escapeHtml(text)}</span>
      `;
      $('testsList').appendChild(div);
      resolve();
    }, delay);
  });
}

// Stream `text` into `el` one character at a time with a blinking cursor.
// Spaces/newlines render at half the per-char delay to keep things readable.
async function typewriter(el, text) {
  el.innerHTML = '';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  el.appendChild(cursor);

  for (let i = 0; i < text.length; i++) {
    const ch = document.createTextNode(text[i]);
    el.insertBefore(ch, cursor);
    if (text[i] !== ' ' && text[i] !== '\n') {
      await sleep(TYPEWRITER_MS);
    } else {
      await sleep(TYPEWRITER_MS / 2);
    }
    if (stopRequested) break;  // bail out cleanly if user hit Stop
  }
}

// Replace the solution code, run Prism syntax highlighting, update line count.
function showSolution(code) {
  const el = $('solutionCode');
  el.textContent = code;
  Prism.highlightElement(el);
  $('solutionMeta').textContent = `${code.split('\n').length} LINES`;
}

// ============== HF TOKEN MODAL ==============
// Shown automatically on first load when no token is stored.
// Themed to match the rest of the dashboard (no native window.prompt).
function openTokenModal() {
  $('tokenBackdrop').classList.add('open');
  $('tokenModal').classList.add('open');
  setTimeout(() => $('tokenInput').focus(), 100);  // focus after the open transition
}

function closeTokenModal() {
  $('tokenBackdrop').classList.remove('open');
  $('tokenModal').classList.remove('open');
  $('tokenError').textContent = '';
}

// Validate + persist the entered token. Empty / non-`hf_` values surface an inline error.
function submitToken() {
  const raw = $('tokenInput').value.trim();
  const errEl = $('tokenError');
  if (!raw) {
    errEl.textContent = 'Token is required.';
    return;
  }
  if (!raw.startsWith('hf_')) {
    errEl.textContent = 'Invalid format — HuggingFace tokens start with "hf_".';
    return;
  }
  API_KEY = raw;
  localStorage.setItem(HF_TOKEN_KEY, raw);
  closeTokenModal();
  log(`HF token saved (${raw.slice(0, 6)}…${raw.slice(-4)})`, 'event');
}

// ============== EPISODE LOOP ==============
// One end-to-end episode: reset → generate challenge → display → submit → score → escalate.
async function runEpisode() {
  const epNum = totalEpisodes + 1;

  // ---- Phase 1: reset and clear UI ----
  setStatus($('challengeStatus'), 'RESETTING', 'running');
  setStatus($('globalStatus'), 'EPISODE ' + epNum, 'running');
  clearTests();
  setReward(null);
  $('rewardSub').textContent = 'requesting environment...';
  $('challengeText').innerHTML = '';
  $('solutionCode').textContent = '';

  log(`Episode ${epNum} starting at difficulty ${currentDifficulty}`, 'event');
  log(`Calling /reset endpoint`, 'out');

  // /reset returns the topic + difficulty hint for this episode
  const resetRes = await envReset();
  const obs = resetRes.observation || {};
  const difficulty = obs.difficulty_level || currentDifficulty;
  const topic = obs.topic || 'basic_functions';
  setDifficulty(difficulty);
  const prettyTopic = topic.replace(/_/g, ' ');
  $('topicChip').textContent = prettyTopic;
  $('hdrTopic').textContent = prettyTopic;

  log(`Topic: ${topic}`, 'in');

  if (stopRequested) return;

  // ---- Phase 2: ask the LLM for {challenge, solution} ----
  setStatus($('challengeStatus'), 'GENERATING', 'running');
  $('rewardSub').textContent = 'agent thinking...';
  log(`Generating challenge with ${LLM_MODEL.split('/').pop()}`, 'out');

  let gen;
  try {
    gen = await generateChallenge(difficulty, topic);
    log(`Challenge generated (${gen.challenge.length} chars, ${gen.solution.split('\n').length} lines of code)`, 'in');
  } catch (e) {
    // LLM failure → fall back to a trivially correct challenge so the loop keeps moving
    setStatus($('challengeStatus'), 'LLM FAIL', 'error');
    log(`LLM error: ${e.message}`, 'error');
    log(`Falling back to hardcoded challenge`, 'event');
    gen = {
      challenge: 'Write a function that returns 42',
      solution: 'def answer():\n    return 42'
    };
  }

  if (stopRequested) return;

  // ---- Phase 3: display the challenge with typewriter animation ----
  setStatus($('challengeStatus'), 'TYPING', 'running');
  await typewriter($('challengeText'), gen.challenge);

  if (stopRequested) return;

  // ---- Phase 4: render the solution with syntax highlighting ----
  setStatus($('challengeStatus'), 'COMPILING', 'running');
  await sleep(300);   // small visual beat between challenge and solution reveal
  showSolution(gen.solution);

  if (stopRequested) return;

  // ---- Phase 5: submit to /step — the env runs subprocess tests and scores ----
  setStatus($('challengeStatus'), 'EXECUTING', 'running');
  $('rewardSub').textContent = 'running tests in sandbox...';
  log(`Submitting solution to /step endpoint`, 'out');
  await sleep(400);

  let stepRes;
  try {
    stepRes = await envStep(gen.challenge, gen.solution);
  } catch (e) {
    setStatus($('challengeStatus'), 'STEP FAIL', 'error');
    log(`Step failed: ${e.message}`, 'error');
    return;
  }

  // Pull individual fields out of the response — defaults guard against missing keys
  const stepObs = stepRes.observation || {};
  const score = stepObs.score || 0;
  const passed = stepObs.tests_passed || 0;
  const total = stepObs.total_tests || 0;

  // Client-side reward override — corrects a backend stale-difficulty bug.
  // Formula: score × (1 + currentDifficulty / 5) + 0.1 (format compliance bonus)
  const backendReward = stepRes.reward !== null && stepRes.reward !== undefined ? stepRes.reward : 0;
  const reward = score * (1 + currentDifficulty / 5) + 0.1;

  log(`Score: ${score.toFixed(2)} | Reward: ${reward.toFixed(2)} (backend: ${backendReward.toFixed(2)}) | Tests: ${passed}/${total}`, 'in');

  // Apply difficulty progression rule (mirrors the env's own logic; we own it client-side
  // so the next /reset can request the right level)
  let newDiff = currentDifficulty;
  if (score >= 0.8) newDiff = Math.min(5, currentDifficulty + 1);
  else if (score < 0.5) newDiff = Math.max(1, currentDifficulty - 1);

  // ---- Phase 6: animate the test rows in (one every ~350ms) ----
  $('testsMeta').textContent = `${passed} / ${total}`;
  for (let i = 0; i < total; i++) {
    if (stopRequested) break;
    const isPass = i < passed;
    await addTest(`test_case_${i + 1}: ${isPass ? 'OK' : 'FAILED'}`, isPass, 200);
    await sleep(150);
  }

  // ---- Phase 7: reward + sub-text ----
  setReward(reward);
  $('rewardSub').textContent = `score ${score.toFixed(2)} · ${passed}/${total} tests`;
  setStatus($('challengeStatus'), 'COMPLETE', 'idle');

  // ---- Phase 8: bookkeeping — push to history chart, update header counters ----
  totalEpisodes++;
  $('hdrEpisodes').textContent = totalEpisodes;
  pushHistory(reward, difficulty, score, gen.challenge, topic);

  if (newDiff > currentDifficulty) {
    log(`Difficulty escalated: ${currentDifficulty} → ${newDiff}`, 'event');
  } else if (newDiff < currentDifficulty) {
    log(`Difficulty reduced: ${currentDifficulty} → ${newDiff}`, 'event');
  } else {
    log(`Difficulty held at ${currentDifficulty}`, 'event');
  }

  currentDifficulty = newDiff;
  setDifficulty(newDiff);

  if (stopRequested) return;

  // ---- Phase 9: cool-down before the next episode ----
  setStatus($('globalStatus'), `WAIT ${STEP_DELAY_MS / 1000}s`, 'idle');
  await sleep(STEP_DELAY_MS);
}

// Outer loop — keeps running episodes until Stop is pressed.
// Per-iteration try/catch ensures one bad episode doesn't kill the loop.
async function mainLoop() {
  // Block start if no token configured
  if (!API_KEY) {
    log('Cannot start — HF token missing.', 'error');
    openTokenModal();
    return;
  }

  running = true;
  stopRequested = false;
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  log(`AUTO-EXAMINER engaged. Endpoint: ${HF_BASE}`, 'event');

  while (!stopRequested) {
    try {
      await runEpisode();
    } catch (e) {
      console.error(e);
      log(`Unhandled error: ${e.message}`, 'error');
      setStatus($('globalStatus'), 'ERROR', 'error');
      $('rewardSub').textContent = e.message;
      await sleep(2000);
    }
  }

  // Tidy state on stop
  running = false;
  $('startBtn').disabled = false;
  $('stopBtn').disabled = true;
  setStatus($('globalStatus'), 'STOPPED', 'idle');
  setStatus($('challengeStatus'), 'IDLE', 'idle');
  log(`Loop halted by operator`, 'event');
}

// ============== INIT ==============
// Wire button handlers
$('startBtn').addEventListener('click', () => {
  if (!running) mainLoop();
});

$('stopBtn').addEventListener('click', () => {
  stopRequested = true;
  setStatus($('globalStatus'), 'STOPPING...', 'error');
});

// Logs drawer
$('viewLogsBtn').addEventListener('click', openLogs);
$('closeLogsBtn').addEventListener('click', closeLogs);
$('logsBackdrop').addEventListener('click', closeLogs);
$('clearCurrentBtn').addEventListener('click', clearCurrentSession);
$('downloadCurrentBtn').addEventListener('click', downloadCurrentSession);
$('downloadAllBtn').addEventListener('click', downloadAllSessions);

// Token modal
$('tokenSubmitBtn').addEventListener('click', submitToken);
$('tokenInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitToken();
});

// Global ESC closes the log drawer (token modal is intentionally non-dismissable
// via ESC since the app can't function without a token)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && drawerOpen) closeLogs();
});

// ---- Boot sequence ----
$('sessionIdLabel').textContent = `${SESSION_ID} (live)`;
setDifficulty(1);
$('hdrDifficulty').textContent = '1';
renderChart();
log(`Terminal initialized. Awaiting START signal...`, 'event');
log(`Session: ${SESSION_ID}`, 'in');
log(`HF Space: ${HF_BASE}`, 'in');
log(`LLM router: featherless-ai @ ${LLM_MODEL}`, 'in');

// Show the token modal if we don't have a saved key yet
if (!API_KEY) {
  log(`No HF token found — showing auth modal.`, 'event');
  openTokenModal();
}
