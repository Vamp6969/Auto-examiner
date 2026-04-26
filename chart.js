// ===========================================================================
// chart.js — reward-history bar chart at the bottom of the dashboard
//
// Stores the last MAX_HISTORY (=20, defined in app.js) episodes and renders
// them as colour-tiered bars. Each bar's height is proportional to the reward
// (positive bars use the top 80% of the chart, negative bars dip into the
// bottom 20%). Hover reveals a tooltip with episode #, difficulty, topic
// pill, score, exact reward, and the truncated challenge text.
// ===========================================================================

let rewardHistory = [];   // ring-buffer of {reward, difficulty, score, challenge, topic, episode}

// Add one episode to the history. Trims to MAX_HISTORY entries (FIFO).
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
  // Update the AVG REWARD pill in the header
  const avg = rewardHistory.reduce((s, e) => s + e.reward, 0) / rewardHistory.length;
  document.getElementById('hdrAvg').textContent = avg.toFixed(2);
}

// Map a reward value to a CSS class controlling the bar's gradient + glow.
function rewardTier(r) {
  if (r < 0)    return 't-neg';     // magenta — reward dipped below zero
  if (r >= 1.5) return 't-elite';   // bright green
  if (r >= 1.0) return 't-good';    // cyan
  if (r >= 0.5) return 't-mid';     // yellow
  return 't-low';                   // red — bad episode
}

// Re-render every bar (called on every history push).
function renderChart() {
  const axis = document.getElementById('chartAxis');
  axis.querySelectorAll('.chart-bar').forEach(b => b.remove());   // clear old bars

  if (rewardHistory.length === 0) return;

  // Vertical layout convention:
  //   top 80% of chart = positive rewards 0 → 2.0 (theoretical max with format bonus = 2.10)
  //   bottom 20%       = negative rewards 0 → -1.0
  //   horizontal zero-line sits at 20% from bottom
  const POS_FRAC = 80;
  const NEG_FRAC = 20;
  const POS_MAX = 2.0;
  const NEG_MAX = 1.0;

  document.getElementById('zeroLine').style.bottom = NEG_FRAC + '%';

  // Each bar gets a fixed slot width (slot = 100/MAX_HISTORY) with a small gap each side.
  const slot = 100 / MAX_HISTORY;
  const gap = 0.4;

  rewardHistory.forEach((entry, i) => {
    const bar = document.createElement('div');
    bar.className = 'chart-bar ' + rewardTier(entry.reward);

    // Compute height + bottom-offset based on sign of reward
    const v = entry.reward;
    let heightPct, bottomPct;
    if (v >= 0) {
      heightPct = Math.min(POS_FRAC, (v / POS_MAX) * POS_FRAC);
      bottomPct = NEG_FRAC;     // sit on the zero-line, grow up
    } else {
      heightPct = Math.min(NEG_FRAC, (Math.abs(v) / NEG_MAX) * NEG_FRAC);
      bottomPct = NEG_FRAC - heightPct;   // hang below zero-line, grow down
    }

    bar.style.height = heightPct + '%';
    bar.style.bottom = bottomPct + '%';
    bar.style.left = (i * slot + gap) + '%';
    bar.style.width = (slot - gap * 2) + '%';

    // Inline white reward number, anchored at the bottom of the bar
    const label = document.createElement('span');
    label.className = 'chart-bar-value';
    label.textContent = v.toFixed(2);
    bar.appendChild(label);

    // Tooltip handlers — show on enter, follow cursor, hide on leave
    bar.addEventListener('mouseenter', e => showTooltip(e, entry));
    bar.addEventListener('mousemove', e => moveTooltip(e));
    bar.addEventListener('mouseleave', hideTooltip);

    axis.appendChild(bar);
  });
}

// Trim long challenge strings so the tooltip stays compact.
function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Build + position the tooltip for an entry.
function showTooltip(e, entry) {
  const tip = document.getElementById('chartTooltip');
  const prettyTopic = (entry.topic || '').replace(/_/g, ' ');
  // Topic pill at the top, then the per-stat rows, then the truncated challenge text
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

// Reposition the tooltip near the cursor while clamping to the chart panel bounds.
function moveTooltip(e) {
  const tip = document.getElementById('chartTooltip');
  const panel = tip.offsetParent;
  const rect = panel.getBoundingClientRect();
  let x = e.clientX - rect.left + 12;
  let y = e.clientY - rect.top - tip.offsetHeight - 14;   // sit above the cursor
  // Clamp within the panel so the tooltip never spills off the side
  x = Math.min(Math.max(8, x), rect.width - tip.offsetWidth - 8);
  y = Math.max(8, y);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function hideTooltip() {
  document.getElementById('chartTooltip').classList.remove('show');
}
