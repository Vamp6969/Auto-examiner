---
title: Auto Examiner
emoji: 🎯
colorFrom: purple
colorTo: blue
sdk: docker
pinned: false
---

# Auto-Examiner

A self-improving reinforcement learning environment built on [OpenEnv](https://github.com/openenv/openenv). The agent must both **write** a coding challenge and **solve** it in a single step. Succeed and the problems get harder. Struggle and they get easier.

---

## How It Works

```
Agent → (challenge, solution) → Environment
                                    │
                          LLM generates test cases
                                    │
                          Runs solution in subprocess
                                    │
                          Scores + adjusts difficulty
                                    │
Environment → (score, reward, new_difficulty) → Agent
```

1. The environment sends the agent a `difficulty_level` (1–5) and a `topic` hint
2. The agent generates a `challenge` (problem description) and a `solution` (Python code)
3. An LLM generates up to 5 pytest-style assertions for that challenge
4. Each assertion is executed against the solution in a sandboxed subprocess (3 s timeout)
5. The agent receives feedback: score, reward, and the next difficulty level

Episodes end after **5 steps** or when the agent achieves a **perfect score (1.0)**.

---

## Topics by Difficulty

| Level | Topic | Example |
|---|---|---|
| 1 | `basic_functions` | Sum a list, check even/odd, reverse a string |
| 2 | `algorithms` | Binary search, bubble sort, fibonacci |
| 3 | `data_structures` | Linked list, stack, queue operations |
| 4 | `multi_function` | Interdependent functions solving a larger problem |
| 5 | `complex_algorithms` | Complex algorithms with edge cases and efficiency |

---

## Action Space

| Field | Type | Description |
|---|---|---|
| `challenge` | `str` | The coding problem the agent wrote |
| `solution` | `str` | Python code that solves the challenge |

## Observation Space

| Field | Type | Description |
|---|---|---|
| `difficulty_level` | `int` | Current difficulty (1–5) |
| `topic` | `str` | Topic hint for challenge generation |
| `score` | `float` | Fraction of tests passed (0.0–1.0) |
| `tests_passed` | `int` | Number of passing test assertions |
| `total_tests` | `int` | Total assertions generated |
| `feedback` | `str` | Human-readable result summary |
| `challenge_valid` | `bool` | Whether challenge + solution were non-empty |
| `new_difficulty` | `int` | Difficulty for the next step |
| `done` | `bool` | Whether the episode has ended |
| `reward` | `float` | Total reward for this step |

---

## Reward Functions

Four independent signals combined and clamped to **[−1.0, 2.0]**:

| Signal | Range | Logic |
|---|---|---|
| Correctness | [0, 1] | `tests_passed / total_tests` |
| Difficulty multiplier | [0, 2] | Scales correctness by `1 + level/5` — harder problems pay more |
| Format compliance | [−0.2, 0.1] | Penalizes empty or missing `def` in solution |
| Timeout penalty | [−0.3, 0] | −0.3 for timeout, −0.2 for crash |

A perfect solution at difficulty 5 yields a reward of **2.0**. An empty submission yields **−1.0**.

---

## Difficulty Progression

| Score | Effect |
|---|---|
| ≥ 0.8 | Difficulty +1 (max 5) |
| < 0.5 | Difficulty −1 (min 1) |
| 0.5 – 0.8 | Same difficulty, same topic |

---

## Setup

**Requirements:** Python 3.11+, a HuggingFace or OpenAI-compatible API key.

```bash
# Install dependencies
pip install openenv-core openai fastapi uvicorn

# Or with uv
uv sync
```

**Environment variables:**

```bash
export HF_TOKEN="hf_..."                                          # API key
export API_BASE_URL="https://api-inference.huggingface.co/v1"    # LLM endpoint
export MODEL_NAME="Qwen/Qwen2.5-72B-Instruct"                    # Model name
export ENV_BASE_URL="http://localhost:7860"                       # Server URL (for inference.py)
```

---

## Running Locally

**Start the server:**
```bash
uvicorn server.app:app --host 0.0.0.0 --port 7860
```

**Quick smoke test (no LLM needed):**
```bash
# Reset the environment
curl -s -X POST http://localhost:7860/reset \
  -H "Content-Type: application/json" -d '{}' | python3 -m json.tool

# Submit a challenge + solution
curl -s -X POST http://localhost:7860/step \
  -H "Content-Type: application/json" \
  -d '{"action": {"challenge": "Write a function that returns 42", "solution": "def answer():\n    return 42"}}' \
  | python3 -m json.tool
```

**Run the 3-episode baseline (requires LLM env vars):**
```bash
python inference.py
```

This runs episodes at difficulties 1, 3, and 5 and prints a score table.

---

## Using the Client

```python
from client import AutoExaminerEnv
from models import AutoExaminerAction

env_client = AutoExaminerEnv(base_url="http://localhost:7860")

with env_client.sync() as env:
    result = env.reset(difficulty=1)
    obs = result.observation

    while not obs.done:
        action = AutoExaminerAction(
            challenge="Write a function that adds two numbers",
            solution="def add(a, b):\n    return a + b",
        )
        result = env.step(action)
        obs = result.observation
        print(f"Score: {obs.score:.2f} | Reward: {obs.reward:.4f} | Next difficulty: {obs.new_difficulty}")
```

---

## Docker

```bash
docker build -f server/Dockerfile -t auto-examiner .
docker run -p 7860:7860 \
  -e HF_TOKEN=$HF_TOKEN \
  -e API_BASE_URL=$API_BASE_URL \
  -e MODEL_NAME=$MODEL_NAME \
  auto-examiner
```

---

## Project Structure

```
auto-examiner/
├── models.py              # Action / Observation / State definitions
├── client.py              # Typed WebSocket client (AutoExaminerEnv)
├── inference.py           # 3-episode baseline runner
├── openenv.yaml           # OpenEnv manifest
├── pyproject.toml
├── uv.lock
└── server/
    ├── app.py             # FastAPI entrypoint (create_fastapi_app)
    ├── environment.py     # AutoExaminerEnvironment — reset / step / state
    ├── rewards.py         # 4 independent reward functions
    ├── test_generator.py  # LLM-based test case generator with fallback
    └── Dockerfile
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/schema` | Action / observation / state JSON schemas |
| `POST` | `/reset` | Start a new episode (accepts optional `difficulty`) |
| `POST` | `/step` | Submit a challenge + solution, get scored |

---

## Baseline Scores

| Difficulty | Avg Score | Avg Reward | Steps |
|---|---|---|---|
| 1 | TBD | TBD | ≤5 |
| 3 | TBD | TBD | ≤5 |
| 5 | TBD | TBD | ≤5 |

Run `python inference.py` to populate these values.
