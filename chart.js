// ============== REWARD HISTORY CHART ==============
let rewardHistory = [];

function pushHistory(reward, difficulty, score, challenge, topic) {
  rewardHistory.push({
    reward,
    difficulty,
    score,
    challenge: challenge || '',
    topic: topic || '',
    episode: totalEpisodes
  });
  if (rewardHistory.length > MAX_HISTORY) rewardHistory.shift();
  renderChart();
  const avg = rewardHistory.reduce((s, e) => s + e.reward, 0) / rewardHistory.length;
  document.getElementById('hdrAvg').textContent = avg.toFixed(2);
}

function rewardTier(r) {
  if (r < 0)    return 't-neg';
  if (r >= 1.5) return 't-elite';
  if (r >= 1.0) return 't-good';
  if (r >= 0.5) return 't-mid';
  return 't-low';
}

function renderChart() {
  const axis = document.getElementById('chartAxis');
  axis.querySelectorAll('.chart-bar').forEach(b => b.remove());

  if (rewardHistory.length === 0) return;

  // top 80% = positive rewards 0 → 2.0; bottom 20% = negative rewards 0 → -1.0
  const POS_FRAC = 80;
  const NEG_FRAC = 20;
  const POS_MAX = 2.0;
  const NEG_MAX = 1.0;

  document.getElementById('zeroLine').style.bottom = NEG_FRAC + '%';

  const slot = 100 / MAX_HISTORY;
  const gap = 0.4;

  rewardHistory.forEach((entry, i) => {
    const bar = document.createElement('div');
    bar.className = 'chart-bar ' + rewardTier(entry.reward);

    const v = entry.reward;
    let heightPct, bottomPct;
    if (v >= 0) {
      heightPct = Math.min(POS_FRAC, (v / POS_MAX) * POS_FRAC);
      bottomPct = NEG_FRAC;
    } else {
      heightPct = Math.min(NEG_FRAC, (Math.abs(v) / NEG_MAX) * NEG_FRAC);
      bottomPct = NEG_FRAC - heightPct;
    }

    bar.style.height = heightPct + '%';
    bar.style.bottom = bottomPct + '%';
    bar.style.left = (i * slot + gap) + '%';
    bar.style.width = (slot - gap * 2) + '%';

    const label = document.createElement('span');
    label.className = 'chart-bar-value';
    label.textContent = v.toFixed(2);
    bar.appendChild(label);

    bar.addEventListener('mouseenter', e => showTooltip(e, entry));
    bar.addEventListener('mousemove', e => moveTooltip(e));
    bar.addEventListener('mouseleave', hideTooltip);

    axis.appendChild(bar);
  });
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function showTooltip(e, entry) {
  const tip = document.getElementById('chartTooltip');
  const prettyTopic = (entry.topic || '').replace(/_/g, ' ');
  tip.innerHTML = `
    <div class="tt-row tt-topic-row"><span class="tt-pill">${escapeHtml(prettyTopic || 'unknown')}</span></div>
    <div class="tt-row"><span class="tt-key">EPISODE</span><span class="tt-val">#${entry.episode}</span></div>
    <div class="tt-row"><span class="tt-key">DIFFICULTY</span><span class="tt-val">${entry.difficulty}</span></div>
    <div class="tt-row"><span class="tt-key">SCORE</span><span class="tt-val">${(entry.score ?? 0).toFixed(2)}</span></div>
    <div class="tt-row"><span class="tt-key">REWARD</span><span class="tt-val">${entry.reward.toFixed(3)}</span></div>
    <div class="tt-row tt-challenge">
      <span class="tt-key">CHALLENGE</span>
      <span class="tt-val">${escapeHtml(truncate(entry.challenge, 180))}</span>
    </div>
  `;
  tip.classList.add('show');
  moveTooltip(e);
}

function moveTooltip(e) {
  const tip = document.getElementById('chartTooltip');
  const panel = tip.offsetParent;
  const rect = panel.getBoundingClientRect();
  let x = e.clientX - rect.left + 12;
  let y = e.clientY - rect.top - tip.offsetHeight - 14;
  x = Math.min(Math.max(8, x), rect.width - tip.offsetWidth - 8);
  y = Math.max(8, y);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function hideTooltip() {
  document.getElementById('chartTooltip').classList.remove('show');
}
