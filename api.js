// ============== API CALLS ==============
async function envReset() {
  const res = await fetch(`${HF_BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ difficulty: currentDifficulty })
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
  return res.json();
}

async function envStep(challenge, solution) {
  const res = await fetch(`${HF_BASE}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: { challenge, solution } })
  });
  if (!res.ok) throw new Error(`step failed: ${res.status}`);
  return res.json();
}

async function generateChallenge(difficulty, topic) {
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
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: sysPrompt + `\n\nDifficulty: ${difficulty}/5\nTopic: ${topic}`
      }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HF API: ${res.status} ${err.slice(0, 100)}`);
  }
  const data = await res.json();
  let content = (data.choices?.[0]?.message?.content || '').trim();

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
