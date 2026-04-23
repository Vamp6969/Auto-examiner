# Auto-Examiner Design Spec
**Date:** 2026-04-23  
**Status:** Approved

## Problem Statement
Build a self-improving RL environment (OpenEnv Phase 2) where an AI agent generates coding challenges AND solves them in a single step. The environment auto-generates test cases, runs the solution, scores it, and escalates difficulty based on performance.

## Architecture

### Two-sided system

**Server** (`server/`) — FastAPI app via `create_fastapi_app()`:
- `environment.py`: `AutoExaminerEnvironment(Environment)` — core logic
- `rewards.py`: 4 independent reward functions (correctness, difficulty multiplier, format, timeout)
- `test_generator.py`: LLM-generated pytest assertions with hardcoded fallback

**Client / Inference** (root):
- `client.py`: `AutoExaminerEnv(EnvClient)` — typed WebSocket client
- `inference.py`: runs 3 episodes (difficulty 1, 3, 5) and prints baseline scores

## Data Models (`models.py`)

```
AutoExaminerAction(Action):
  challenge: str   # coding problem the agent wrote
  solution: str    # agent's Python solution

AutoExaminerObservation(Observation):
  done: bool, reward: float
  difficulty_level: int (1-5), topic: str
  score: float, tests_passed: int, total_tests: int
  feedback: str, challenge_valid: bool, new_difficulty: int

AutoExaminerState(State):
  episode_id: str, step_count: int
  current_difficulty: int, current_topic: str
  total_episodes: int, avg_reward: float
```

## Environment Logic

### reset()
- Accept optional `difficulty` override; otherwise use tracked difficulty
- Pick topic from `TOPICS[difficulty-1]`
- Return observation with `difficulty_level` + `topic` hint

### step()
1. Validate action (challenge + solution non-empty)
2. Call `test_generator.generate_test_cases(challenge, solution)` → list of (assertion, desc)
3. Run solution + each assertion in subprocess with 3s timeout
4. Compute total reward from 4 signals
5. Update difficulty:
   - score ≥ 0.8 → `min(5, difficulty + 1)`
   - score < 0.5 → `max(1, difficulty - 1)`
   - else → same difficulty, rotate topic
6. done = True if step_count ≥ 5 or score == 1.0
7. Return fully populated `AutoExaminerObservation`

## Reward Functions (4 independent signals)

| Function | Range | Purpose |
|---|---|---|
| `reward_correctness` | [0, 1] | Fraction of tests passing |
| `reward_difficulty_multiplier` | [0, 2] | Scales base by (1 + level/5) |
| `reward_format_compliance` | [-0.2, 0.1] | Penalize empty/malformed output |
| `reward_timeout_penalty` | [-0.3, 0] | Penalize crashes and timeouts |
| **total** | **[-1.0, 2.0]** | Clamped combination |

## Test Generator

- Calls LLM (OpenAI client, env vars: `API_BASE_URL`, `MODEL_NAME`, `HF_TOKEN`)
- Prompt asks for 5 pytest-style assertions given challenge + solution
- Parses `assert` lines from LLM response
- Fallback: `[("assert True", "basic fallback")] * 3` — never returns empty list

## Client (`client.py`)

`AutoExaminerEnv(EnvClient[AutoExaminerAction, AutoExaminerObservation, AutoExaminerState])`:
- `_step_payload(action)` → `{"challenge": ..., "solution": ...}`
- `_parse_result(payload)` → `StepResult[AutoExaminerObservation]`
- `_parse_state(payload)` → `AutoExaminerState`

## Inference (`inference.py`)

- LLM system prompt: expert Python programmer, respond with JSON `{challenge, solution}`
- Runs 3 episodes at difficulties 1, 3, 5
- Uses `AutoExaminerEnv(base_url).sync()` context manager
- Prints per-step scores and final baseline table
- Must complete under 20 minutes

## Subprocess Execution

Each test case runs as:
```python
exec(solution_code + "\n" + assertion_string)
```
In a `subprocess.run(["python", "-c", code], timeout=3)` call.

## File Structure

```
auto_examiner/
├── models.py
├── client.py
├── inference.py
├── openenv.yaml
├── README.md
├── pyproject.toml
└── server/
    ├── __init__.py
    ├── app.py
    ├── environment.py
    ├── rewards.py
    ├── test_generator.py
    └── Dockerfile
```

## Critical Requirements
- `openenv validate` must pass (requires `openenv.yaml` at root)
- Docker build must work
- `[project.scripts]` entry `server = "server.app:main"` in pyproject.toml
- All env vars via `os.getenv()` — never hardcoded
- Server responds to `/health` and `/reset`
- `inference.py` runs end-to-end without errors

## Build Order
1. models.py → 2. server/rewards.py → 3. server/test_generator.py → 4. server/environment.py → 5. server/app.py → 6. client.py → 7. inference.py → 8. openenv.yaml → 9. pyproject.toml → 10. Dockerfile → 11. README.md
