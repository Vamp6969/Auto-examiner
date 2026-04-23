# Auto-Examiner

A self-improving RL environment where an AI agent generates coding challenges, solves them, and faces harder challenges based on performance.

## Problem Statement

Traditional RL environments present fixed tasks. Auto-Examiner creates a dynamic curriculum — the agent must both *create* and *solve* challenges. When it succeeds, it earns harder problems. When it struggles, it gets easier ones. The environment auto-generates test cases and grades solutions in a sandboxed subprocess.

## How It Works

1. The agent receives a `difficulty_level` (1–5) and a `topic` hint
2. The agent outputs a `challenge` (problem description) and `solution` (Python code)
3. The environment LLM-generates 5 test cases for the challenge
4. The solution is run against all test cases in a sandboxed subprocess (3 s timeout each)
5. The agent receives a score, reward, and updated difficulty for the next step

## Action Space

| Field | Type | Description |
|---|---|---|
| `challenge` | `str` | The coding problem the agent wrote |
| `solution` | `str` | Python code that solves the challenge |

## Observation Space

| Field | Type | Description |
|---|---|---|
| `difficulty_level` | `int` (1–5) | Current challenge difficulty |
| `topic` | `str` | Topic hint for challenge generation |
| `score` | `float` | Fraction of tests passed (0.0–1.0) |
| `tests_passed` | `int` | Number of passing tests |
| `total_tests` | `int` | Total tests generated |
| `feedback` | `str` | Human-readable result and next difficulty |
| `new_difficulty` | `int` | Difficulty for the next step |

## Reward Functions

| Function | Range | Signal |
|---|---|---|
| `reward_correctness` | [0, 1] | Fraction of tests passing |
| `reward_difficulty_multiplier` | [0, 2] | Scales by `1 + level/5`; harder = more reward |
| `reward_format_compliance` | [−0.2, 0.1] | Penalizes empty or malformed output |
| `reward_timeout_penalty` | [−0.3, 0] | Penalizes timeouts and crashes |
| **Total (clamped)** | **[−1.0, 2.0]** | Combination of all four signals |

## Difficulty Progression

| Condition | Effect |
|---|---|
| Score ≥ 0.8 | Difficulty + 1 (max 5) |
| Score < 0.5 | Difficulty − 1 (min 1) |
| Otherwise | Same difficulty, topic rotates |

## Setup

```bash
pip install openenv-core openai
```

Set environment variables:
```bash
export API_BASE_URL="https://api-inference.huggingface.co/v1"
export MODEL_NAME="Qwen/Qwen2.5-72B-Instruct"
export HF_TOKEN="hf_..."
```

Start server:
```bash
uvicorn server.app:app --host 0.0.0.0 --port 8000
```

Run inference baseline:
```bash
python inference.py
```

## Baseline Scores

| Difficulty | Avg Score | Avg Reward | Steps |
|---|---|---|---|
| 1 | TBD | TBD | ≤5 |
| 3 | TBD | TBD | ≤5 |
| 5 | TBD | TBD | ≤5 |

*Run `python inference.py` to populate these values.*

## Links

- HF Space: [Vamppog/auto-examiner](https://huggingface.co/spaces/Vamppog/auto-examiner)
- Colab Notebook: TBD
- Blog: TBD
