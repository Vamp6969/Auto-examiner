# Auto-Examiner: Self-Improving AI Through Auto-Curriculum

*Built at the Meta PyTorch OpenEnv Hackathon × Scaler School of Technology — Bangalore, April 2026.*

---

## Why we built this

We kept running into the same wall while thinking about RL environments: they're all static. You write a fixed task bank, the agent grinds through it, eventually masters it, and then... nothing. The reward curve flatlines. Training stalls. If you want the agent to keep improving, you have to manually ship harder problems.

That's not how anyone actually learns. People get better by doing things just slightly past what they can already do. The difficulty adapts to where they are. Why don't our environments work like that?

So we tried to build one that does.

## What Auto-Examiner actually is

The agent doesn't just *solve* problems in our environment — it *writes* them too. It generates a coding challenge, writes a solution to it, and submits both together. The environment grades the solution, and the difficulty for the next round goes up if the agent did well, or down if it struggled. The curriculum builds itself, one episode at a time.

No human in the loop. No fixed task list. Just an agent and a grader and a difficulty dial that responds to performance.

## How a single episode plays out

The agent's action is a JSON object with two fields:

```json
{
  "challenge": "Write a function that returns the nth Fibonacci number...",
  "solution": "def fib(n):\n    if n < 2: return n\n    ..."
}
```

When that hits the environment, here's what happens:

1. We check the challenge is well-formed (not empty, not nonsense)
2. An LLM generates 5 pytest-style assertions for the challenge
3. The agent's solution runs in a sandboxed subprocess with a 3-second timeout
4. We compute a reward across four signals (more on this below)
5. The difficulty for the next episode is adjusted based on the score

Difficulty escalation is dead simple:

- Score ≥ 0.8 → difficulty +1 (capped at 5)
- Score < 0.5 → difficulty −1 (floored at 1)
- 0.5 to 0.8 → same level, different topic

Topics scale with difficulty — `basic_functions` at level 1, all the way up to `complex_algorithms` with edge cases and efficiency requirements at level 5.

## The reward function (this part matters)

We learned pretty early that a single reward signal is easy to game. The agent will find the cheapest path to a high number every time. So we use four independent signals and combine them at the end:

| Signal | Range | What it does |
|---|---|---|
| Correctness | 0.0 – 1.0 | Fraction of tests passing |
| Difficulty multiplier | × 1.2 – × 2.0 | Harder problems pay more (`1 + level/5`) |
| Format compliance | −0.2 – +0.1 | Penalizes empty or malformed submissions |
| Timeout penalty | −0.3 – 0.0 | Punishes infinite loops and crashes |

Everything sums up and gets clamped to `[-1.0, 2.0]`. A perfect solution at difficulty 5 pays out **2.10**. An empty submission gets you **−0.5** or worse. The format and timeout penalties are there specifically so the agent can't spam garbage to farm format bonuses or hang the grader to skip evaluation.

## What 100 episodes told us

We ran 100 evaluation episodes with `Qwen2.5-72B-Instruct` driving the agent (full reproducer in the [Colab notebook](https://colab.research.google.com/drive/1Ookb1w9NMoAgWGt-Ioau8KKOTeEfhATB?usp=sharing)). This wasn't a fine-tuning run — we weren't updating model weights. The point was to validate that the environment actually works the way we designed it across the full difficulty range. Does the difficulty climb correctly? Does the reward scale properly? Does the grader catch failures honestly?

Here's what we got:

- **Average reward:** 1.86 / 2.10 max possible
- **Final 10-episode rolling average:** 1.90
- **Max difficulty reached:** 5 / 5
- **64%** of episodes scored a perfect 1.0
- **100%** completion rate, zero crashes or timeouts

The agent climbs from difficulty 1 to 5 over the first eight episodes and then holds there. But it doesn't sit at the ceiling — there's real variance. Sometimes it fails a level-5 problem, drops back to 4, recovers on the next try. That kind of jagged plateau is exactly what you'd want to see if the environment is being honest about difficulty. It's not too easy, it's not unsolvable, and the agent is genuinely working at the edge of its capability.

If you tried to fake this kind of curve, it'd come out way too smooth.

## How it's built

Nothing fancy in the stack. We picked tools that get out of the way:

- **OpenEnv** — the environment framework, client-server architecture
- **FastAPI + Uvicorn** — server, wrapped via `create_fastapi_app()`
- **Pydantic** — typed Action / Observation / State models
- **Docker** — packaged for Hugging Face Spaces
- **OpenAI client** — LLM calls go through HuggingFace's featherless-ai router
- **Vanilla HTML / CSS / JS** — the live dashboard. No framework, no build step, persistent session logs in localStorage

The dashboard is its own thing — a cyberpunk-styled live view that drives the deployed environment in real time. Watching the difficulty path light up from 1 to 5 while the reward bars climb is genuinely fun, and it made debugging a lot less painful.

## Where this could go

Auto-curriculum is one of the parts of LLM training that we think is criminally underexplored. Static benchmarks teach static skills. The moment you want an agent to keep growing past its initial mastery, you need an environment that adapts to it.

Code is just the starting domain. Anywhere you can programmatically verify a solution — math proofs, debugging tasks, theorem reasoning, even structured tool use — you can build a self-improving curriculum on top. Same blueprint, different verifier.

That's the direction we're excited about.

---

**Live demo:** [huggingface.co/spaces/Vamppog/Auto-examiner](https://huggingface.co/spaces/Vamppog/Auto-examiner)
**Code:** [github.com/Vamp6969/Auto-examiner](https://github.com/Vamp6969/Auto-examiner)
**Colab notebook:** [open in Colab](https://colab.research.google.com/drive/1Ookb1w9NMoAgWGt-Ioau8KKOTeEfhATB?usp=sharing)

*Team Vamp — Tushar A, Padmashree, Pranav.*
