// ============== CONFIG ==============
const HF_BASE = 'https://vamppog-auto-examiner.hf.space';
const LLM_BASE = 'https://router.huggingface.co/featherless-ai/v1/chat/completions';
const LLM_MODEL = 'Qwen/Qwen2.5-72B-Instruct';
const TYPEWRITER_MS = 10;
const STEP_DELAY_MS = 3000;
const MAX_HISTORY = 20;
const HF_TOKEN_KEY = 'ax:hf_token';

// ============== STATE ==============
let API_KEY = localStorage.getItem(HF_TOKEN_KEY) || '';
if (!API_KEY) {
  const entered = window.prompt('Enter your HuggingFace token (hf_...) — required to call the LLM:');
  if (entered && entered.trim().startsWith('hf_')) {
    API_KEY = entered.trim();
    localStorage.setItem(HF_TOKEN_KEY, API_KEY);
  }
}
let running = false;
let stopRequested = false;
let totalEpisodes = 0;
let currentDifficulty = 1;

// ============== UI HELPERS ==============
const $ = id => document.getElementById(id);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setStatus(el, text, kind = 'idle') {
  el.className = 'status-pill ' + kind;
  el.innerHTML = `<span class="status-dot"></span>${text}`;
}

function setReward(value) {
  const v = $('rewardValue');
  v.textContent = value === null ? '—' : value.toFixed(3);
  v.className = 'reward-value';
  if (value === null) return;
  if (value >= 1.0) v.classList.add('high');
  else if (value >= 0.5) v.classList.add('mid');
  else v.classList.add('low');
}

function setDifficulty(level) {
  currentDifficulty = level;
  $('hdrDifficulty').textContent = level;
  $('progSub').textContent = `level: ${level} / 5`;
  document.querySelectorAll('.prog-step').forEach(el => {
    const l = parseInt(el.dataset.level);
    el.className = 'prog-step';
    if (l === level) el.classList.add('active');
    else if (l < level) el.classList.add('passed');
  });
}

function clearTests() {
  $('testsList').innerHTML = '';
  $('testsMeta').textContent = '0 / 0';
}

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
    if (stopRequested) break;
  }
}

function showSolution(code) {
  const el = $('solutionCode');
  el.textContent = code;
  Prism.highlightElement(el);
  $('solutionMeta').textContent = `${code.split('\n').length} LINES`;
}

// ============== EPISODE LOOP ==============
async function runEpisode() {
  const epNum = totalEpisodes + 1;

  setStatus($('challengeStatus'), 'RESETTING', 'running');
  setStatus($('globalStatus'), 'EPISODE ' + epNum, 'running');
  clearTests();
  setReward(null);
  $('rewardSub').textContent = 'requesting environment...';
  $('challengeText').innerHTML = '';
  $('solutionCode').textContent = '';

  log(`Episode ${epNum} starting at difficulty ${currentDifficulty}`, 'event');
  log(`Calling /reset endpoint`, 'out');

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

  setStatus($('challengeStatus'), 'GENERATING', 'running');
  $('rewardSub').textContent = 'agent thinking...';
  log(`Generating challenge with ${LLM_MODEL.split('/').pop()}`, 'out');

  let gen;
  try {
    gen = await generateChallenge(difficulty, topic);
    log(`Challenge generated (${gen.challenge.length} chars, ${gen.solution.split('\n').length} lines of code)`, 'in');
  } catch (e) {
    setStatus($('challengeStatus'), 'LLM FAIL', 'error');
    log(`LLM error: ${e.message}`, 'error');
    log(`Falling back to hardcoded challenge`, 'event');
    gen = {
      challenge: 'Write a function that returns 42',
      solution: 'def answer():\n    return 42'
    };
  }

  if (stopRequested) return;

  setStatus($('challengeStatus'), 'TYPING', 'running');
  await typewriter($('challengeText'), gen.challenge);

  if (stopRequested) return;

  setStatus($('challengeStatus'), 'COMPILING', 'running');
  await sleep(300);
  showSolution(gen.solution);

  if (stopRequested) return;

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

  const stepObs = stepRes.observation || {};
  const score = stepObs.score || 0;
  const passed = stepObs.tests_passed || 0;
  const total = stepObs.total_tests || 0;

  // Client-side reward override (corrects backend stale-difficulty bug)
  const backendReward = stepRes.reward !== null && stepRes.reward !== undefined ? stepRes.reward : 0;
  const reward = score * (1 + currentDifficulty / 5) + 0.1;

  log(`Score: ${score.toFixed(2)} | Reward: ${reward.toFixed(2)} (backend: ${backendReward.toFixed(2)}) | Tests: ${passed}/${total}`, 'in');

  let newDiff = currentDifficulty;
  if (score >= 0.8) newDiff = Math.min(5, currentDifficulty + 1);
  else if (score < 0.5) newDiff = Math.max(1, currentDifficulty - 1);

  $('testsMeta').textContent = `${passed} / ${total}`;
  for (let i = 0; i < total; i++) {
    if (stopRequested) break;
    const isPass = i < passed;
    await addTest(`test_case_${i + 1}: ${isPass ? 'OK' : 'FAILED'}`, isPass, 200);
    await sleep(150);
  }

  setReward(reward);
  $('rewardSub').textContent = `score ${score.toFixed(2)} · ${passed}/${total} tests`;
  setStatus($('challengeStatus'), 'COMPLETE', 'idle');

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

  setStatus($('globalStatus'), `WAIT ${STEP_DELAY_MS / 1000}s`, 'idle');
  await sleep(STEP_DELAY_MS);
}

async function mainLoop() {
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

  running = false;
  $('startBtn').disabled = false;
  $('stopBtn').disabled = true;
  setStatus($('globalStatus'), 'STOPPED', 'idle');
  setStatus($('challengeStatus'), 'IDLE', 'idle');
  log(`Loop halted by operator`, 'event');
}

// ============== INIT ==============
$('startBtn').addEventListener('click', () => {
  if (!running) mainLoop();
});

$('stopBtn').addEventListener('click', () => {
  stopRequested = true;
  setStatus($('globalStatus'), 'STOPPING...', 'error');
});

$('viewLogsBtn').addEventListener('click', openLogs);
$('closeLogsBtn').addEventListener('click', closeLogs);
$('logsBackdrop').addEventListener('click', closeLogs);
$('clearCurrentBtn').addEventListener('click', clearCurrentSession);
$('downloadCurrentBtn').addEventListener('click', downloadCurrentSession);
$('downloadAllBtn').addEventListener('click', downloadAllSessions);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && drawerOpen) closeLogs();
});

// boot
$('sessionIdLabel').textContent = `${SESSION_ID} (live)`;
setDifficulty(1);
$('hdrDifficulty').textContent = '1';
renderChart();
log(`Terminal initialized. Awaiting START signal...`, 'event');
log(`Session: ${SESSION_ID}`, 'in');
log(`HF Space: ${HF_BASE}`, 'in');
log(`LLM router: featherless-ai @ ${LLM_MODEL}`, 'in');
