// ===========================================================================
// api.js — thin HTTP layer for the OpenEnv server + the LLM router
//
// Three calls are exposed:
//   envReset()                    → POST /reset on the HF Space (returns observation)
//   envStep(challenge, solution)  → POST /step  on the HF Space (returns reward + obs)
//   generateChallenge(diff, topic) → ask the LLM for {challenge, solution} JSON
//
// Globals consumed (defined in app.js): HF_BASE, currentDifficulty,
// LLM_BASE, LLM_MODEL, API_KEY.
// ===========================================================================

// POST /reset — start a new episode. We pass `currentDifficulty` so the env
// uses the client-tracked level (the HF Space sometimes resets state between
// requests; explicit difficulty bypasses that).
async function envReset() {
  const res = await fetch(`${HF_BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ difficulty: currentDifficulty })
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
  return res.json();
}

// POST /step — submit the agent's challenge + solution. The env runs the
// solution in a sandboxed subprocess, scores it, and returns reward + obs.
async function envStep(challenge, solution) {
  const res = await fetch(`${HF_BASE}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: { challenge, solution } })
  });
  if (!res.ok) throw new Error(`step failed: ${res.status}`);
  return res.json();
}

// Ask the LLM (Qwen via featherless-ai router by default) to write a coding
// challenge and solve it for the given difficulty + topic. Forces strict JSON.
async function generateChallenge(difficulty, topic) {
  // Prompt is pinned: "ONLY valid JSON" reduces hallucinated markdown wrappers.
  const sysPrompt = `You are an expert Python programmer.
Generate a coding challenge at difficulty ${difficulty}/5 on topic "${topic}", and solve it.
Respond with ONLY valid JSON in this exact format (no markdown):
{"challenge": "Write a function that...", "solution": "def solve(...):\\n    ..."}`;

  const res = await fetch(LLM_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 1024,
      temperature: 0.7,    // some variety but not chaos
      messages: [{
        role: 'user',
        content: sysPrompt + `\n\nDifficulty: ${difficulty}/5\nTopic: ${topic}`
      }]
    })
  });

  if (!res.ok) {
    // Surface a truncated body so the log can show what the router rejected.
    const err = await res.text();
    throw new Error(`HF API: ${res.status} ${err.slice(0, 100)}`);
  }
  const data = await res.json();
  let content = (data.choices?.[0]?.message?.content || '').trim();

  // Some models stubbornly wrap JSON in ``` fences despite the system prompt.
  // Pull out whatever's inside the first fenced block if we see one.
  if (content.startsWith('```')) {
    const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) content = m[1].trim();
  }
  const parsed = JSON.parse(content);
  return {
    challenge: parsed.challenge || '',
    solution: parsed.solution || ''
  };
}
