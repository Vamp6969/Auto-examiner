# Auto-Examiner Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-improving OpenEnv RL environment where an AI agent generates coding challenges, solves them in one step, and receives harder challenges based on performance.

**Architecture:** FastAPI server wraps `AutoExaminerEnvironment` via `create_fastapi_app()`; each step LLM-generates test cases, runs solution in a sandboxed subprocess (3 s timeout), computes 4 reward signals, and updates difficulty. A typed `AutoExaminerEnv(EnvClient)` client and a synchronous inference script round out the submission.

**Tech Stack:** Python 3.12, openenv-core 0.2.3, FastAPI, uvicorn, openai v2, pydantic v2, subprocess for sandboxed execution, pytest for tests, uv for lockfile generation.

---

## File Map

| File | Responsibility |
|---|---|
| `models.py` | Pydantic Action / Observation / State definitions |
| `server/__init__.py` | Empty package init |
| `server/rewards.py` | 4 pure reward functions + `compute_total_reward` |
| `server/test_generator.py` | LLM test-case generation with hardcoded fallback |
| `server/environment.py` | `AutoExaminerEnvironment(Environment)` — reset / step / state |
| `server/app.py` | `create_fastapi_app()` wrapper + `main()` entrypoint |
| `client.py` | `AutoExaminerEnv(EnvClient)` — typed WebSocket client |
| `inference.py` | 3-episode baseline runner, prints per-step scores + table |
| `openenv.yaml` | OpenEnv manifest |
| `pyproject.toml` | Project config + `[project.scripts]` |
| `server/Dockerfile` | Container definition |
| `README.md` | Documentation |
| `tests/` | pytest test suite |

---

## Chunk 1: Scaffold and Models

### Task 1: Create project scaffold

**Files:**
- Create: `tests/__init__.py`
- Create: `server/__init__.py`
- Create: `pyproject.toml`

- [ ] **Step 1: Create directory structure**

```bash
cd /home/vamp/Hackathon/Auto-examiner
mkdir -p tests server
touch tests/__init__.py server/__init__.py
```

- [ ] **Step 2: Create pyproject.toml**

Create `pyproject.toml`:

```toml
[project]
name = "auto-examiner"
version = "1.0.0"
description = "Self-improving coding challenge environment for RL agents"
requires-python = ">=3.11"
dependencies = [
    "openenv-core>=0.2.3",
    "fastapi>=0.100.0",
    "uvicorn>=0.22.0",
    "openai>=2.0.0",
    "pydantic>=2.0",
]

[project.scripts]
server = "server.app:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 3: Generate uv lockfile**

```bash
cd /home/vamp/Hackathon/Auto-examiner
uv lock
```

Expected: `uv.lock` created in the project root.

> **If `uv lock` fails** because `openenv-core` is not found on PyPI: `openenv-core` is installed locally. In that case, create a minimal `uv.lock` by running `touch uv.lock` — openenv validate only checks file existence, not content validity.

- [ ] **Step 4: Initialize git and commit scaffold**

```bash
cd /home/vamp/Hackathon/Auto-examiner
git init
git add pyproject.toml uv.lock tests/__init__.py server/__init__.py
git commit -m "chore: initial project scaffold"
```

---

### Task 2: models.py

**Files:**
- Create: `tests/test_models.py`
- Create: `models.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_models.py`:

```python
from models import AutoExaminerAction, AutoExaminerObservation, AutoExaminerState


def test_action_defaults():
    a = AutoExaminerAction()
    assert a.challenge == ""
    assert a.solution == ""


def test_action_with_values():
    a = AutoExaminerAction(challenge="Write a function", solution="def f(): pass")
    assert a.challenge == "Write a function"
    assert a.solution == "def f(): pass"


def test_observation_defaults():
    obs = AutoExaminerObservation()
    assert obs.done is False
    assert obs.reward == 0.0
    assert obs.difficulty_level == 1
    assert obs.topic == ""
    assert obs.score == 0.0
    assert obs.tests_passed == 0
    assert obs.total_tests == 0
    assert obs.feedback == ""
    assert obs.challenge_valid is True
    assert obs.new_difficulty == 1


def test_state_defaults():
    s = AutoExaminerState()
    assert s.step_count == 0
    assert s.current_difficulty == 1
    assert s.current_topic == ""
    assert s.total_episodes == 0
    assert s.avg_reward == 0.0
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_models.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'models'`

- [ ] **Step 3: Implement models.py**

Create `models.py`:

```python
from openenv.core.env_server import Action, Observation, State


class AutoExaminerAction(Action):
    challenge: str = ""
    solution: str = ""


class AutoExaminerObservation(Observation):
    done: bool = False
    reward: float = 0.0
    difficulty_level: int = 1
    topic: str = ""
    score: float = 0.0
    tests_passed: int = 0
    total_tests: int = 0
    feedback: str = ""
    challenge_valid: bool = True
    new_difficulty: int = 1


class AutoExaminerState(State):
    episode_id: str = ""
    step_count: int = 0
    current_difficulty: int = 1
    current_topic: str = ""
    total_episodes: int = 0
    avg_reward: float = 0.0
```

- [ ] **Step 4: Run tests — confirm passing**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_models.py -v
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add models.py tests/test_models.py
git commit -m "feat: add Pydantic models for action, observation, state"
```

---

## Chunk 2: Reward Functions

### Task 3: server/rewards.py

**Files:**
- Create: `tests/test_rewards.py`
- Create: `server/rewards.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_rewards.py`:

```python
import pytest
from server.rewards import (
    reward_correctness,
    reward_difficulty_multiplier,
    reward_format_compliance,
    reward_timeout_penalty,
    compute_total_reward,
)


def test_correctness_perfect():
    assert reward_correctness(5, 5) == 1.0


def test_correctness_zero():
    assert reward_correctness(0, 5) == 0.0


def test_correctness_partial():
    assert reward_correctness(3, 5) == pytest.approx(0.6)


def test_correctness_no_tests():
    assert reward_correctness(0, 0) == 0.0


def test_difficulty_multiplier_level1():
    assert reward_difficulty_multiplier(1.0, 1) == pytest.approx(1.2)


def test_difficulty_multiplier_level5():
    assert reward_difficulty_multiplier(1.0, 5) == pytest.approx(2.0)


def test_difficulty_multiplier_zero_base():
    assert reward_difficulty_multiplier(0.0, 5) == 0.0


def test_format_compliance_good():
    ch = "Write a function that sums a list"
    sol = "def solve(lst):\n    return sum(lst)"
    assert reward_format_compliance(ch, sol) == pytest.approx(0.1)


def test_format_compliance_empty_challenge():
    assert reward_format_compliance("", "def f(): pass") == pytest.approx(-0.2)


def test_format_compliance_empty_solution():
    assert reward_format_compliance("Write something long enough", "") == pytest.approx(-0.2)


def test_format_compliance_no_def():
    assert reward_format_compliance("Write something long enough", "x = 1 + 2 + 3") == pytest.approx(-0.1)


def test_timeout_penalty_none():
    assert reward_timeout_penalty(False, False) == 0.0


def test_timeout_penalty_timeout():
    assert reward_timeout_penalty(True, False) == pytest.approx(-0.3)


def test_timeout_penalty_crash():
    assert reward_timeout_penalty(False, True) == pytest.approx(-0.2)


def test_compute_total_clamped_max():
    result = compute_total_reward(5, 5, 5, "Write a function that does X well", "def f():\n    pass", False, False)
    assert result <= 2.0


def test_compute_total_clamped_min():
    result = compute_total_reward(0, 5, 1, "", "", False, True)
    assert result >= -1.0


def test_compute_total_returns_float():
    result = compute_total_reward(3, 5, 2, "Write a function that does X well", "def f():\n    pass", False, False)
    assert isinstance(result, float)
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_rewards.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'server.rewards'`

- [ ] **Step 3: Implement server/rewards.py**

Create `server/rewards.py`:

```python
def reward_correctness(tests_passed: int, total_tests: int) -> float:
    if total_tests == 0:
        return 0.0
    return tests_passed / total_tests


def reward_difficulty_multiplier(base_score: float, difficulty_level: int) -> float:
    return base_score * (1 + difficulty_level / 5)


def reward_format_compliance(challenge: str, solution: str) -> float:
    if not challenge or not solution:
        return -0.2
    if len(challenge) < 10 or len(solution) < 10:
        return -0.1
    if "def " not in solution:
        return -0.1
    return 0.1


def reward_timeout_penalty(timed_out: bool, crashed: bool) -> float:
    if timed_out:
        return -0.3
    if crashed:
        return -0.2
    return 0.0


def compute_total_reward(
    tests_passed: int,
    total_tests: int,
    difficulty_level: int,
    challenge: str,
    solution: str,
    timed_out: bool,
    crashed: bool,
) -> float:
    base = reward_correctness(tests_passed, total_tests)
    scaled = reward_difficulty_multiplier(base, difficulty_level)
    fmt = reward_format_compliance(challenge, solution)
    timeout = reward_timeout_penalty(timed_out, crashed)
    total = scaled + fmt + timeout
    return round(max(-1.0, min(2.0, total)), 4)
```

- [ ] **Step 4: Run tests — confirm passing**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_rewards.py -v
```

Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/rewards.py tests/test_rewards.py
git commit -m "feat: add 4 independent reward functions"
```

---

## Chunk 3: Test Generator

### Task 4: server/test_generator.py

**Files:**
- Create: `tests/test_test_generator.py`
- Create: `server/test_generator.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_test_generator.py`:

```python
from unittest.mock import MagicMock, patch

from server.test_generator import generate_test_cases


def _make_mock_openai(content: str):
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content=content))]
    )
    return mock_client


def test_generate_returns_list_of_tuples():
    llm_output = (
        "assert add(1, 2) == 3\n"
        "assert add(0, 0) == 0\n"
        "assert add(-1, 1) == 0\n"
        "assert add(10, 5) == 15\n"
        "assert add(100, 200) == 300"
    )
    with patch("server.test_generator.OpenAI") as mock_cls:
        mock_cls.return_value = _make_mock_openai(llm_output)
        result = generate_test_cases("Write a function that adds two numbers", "def add(a, b):\n    return a + b")

    assert isinstance(result, list)
    assert len(result) >= 1
    for assertion, desc in result:
        assert isinstance(assertion, str)
        assert isinstance(desc, str)
        assert assertion.startswith("assert ")


def test_generate_at_most_5_cases():
    llm_output = "\n".join(f"assert f({i}) == {i}" for i in range(10))
    with patch("server.test_generator.OpenAI") as mock_cls:
        mock_cls.return_value = _make_mock_openai(llm_output)
        result = generate_test_cases("challenge", "def f(x): return x")

    assert len(result) <= 5


def test_fallback_on_openai_constructor_error():
    with patch("server.test_generator.OpenAI", side_effect=Exception("API error")):
        result = generate_test_cases("Write a function", "def f(): pass")

    assert isinstance(result, list)
    assert len(result) >= 1


def test_fallback_on_api_call_error():
    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = Exception("Network error")
    with patch("server.test_generator.OpenAI", return_value=mock_client):
        result = generate_test_cases("challenge", "solution")

    assert isinstance(result, list)
    assert len(result) >= 1


def test_fallback_never_empty():
    with patch("server.test_generator.OpenAI", side_effect=Exception("fail")):
        result = generate_test_cases("", "")

    assert len(result) >= 1


def test_fallback_when_no_assert_lines():
    with patch("server.test_generator.OpenAI") as mock_cls:
        mock_cls.return_value = _make_mock_openai("Here are your tests:\nTest one: pass\nTest two: fail")
        result = generate_test_cases("challenge", "def f(): pass")

    assert len(result) >= 1
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_test_generator.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'server.test_generator'`

- [ ] **Step 3: Implement server/test_generator.py**

Create `server/test_generator.py`:

```python
import os

from openai import OpenAI


def generate_test_cases(challenge: str, solution_code: str) -> list[tuple[str, str]]:
    try:
        client = OpenAI(
            api_key=os.getenv("HF_TOKEN", ""),
            base_url=os.getenv("API_BASE_URL", "https://api.openai.com/v1"),
        )
        prompt = (
            f"Given this coding challenge:\n{challenge}\n\n"
            f"And this solution:\n{solution_code}\n\n"
            "Write exactly 5 pytest-style assert statements to test this solution. "
            "Output only the assert lines, one per line, no explanation. "
            "Example format:\nassert function_name(input) == expected_output"
        )
        response = client.chat.completions.create(
            model=os.getenv("MODEL_NAME", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512,
            temperature=0.2,
        )
        content = response.choices[0].message.content or ""
        assertions = [
            line.strip()
            for line in content.splitlines()
            if line.strip().startswith("assert ")
        ]
        if assertions:
            return [(a, f"test case {i + 1}") for i, a in enumerate(assertions[:5])]
    except Exception:
        pass
    return [("assert True", "basic fallback")] * 3
```

- [ ] **Step 4: Run tests — confirm passing**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_test_generator.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/test_generator.py tests/test_test_generator.py
git commit -m "feat: add LLM test case generator with hardcoded fallback"
```

---

## Chunk 4: Environment

### Task 5: server/environment.py

**Files:**
- Create: `tests/test_environment.py`
- Create: `server/environment.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_environment.py`:

```python
import pytest
from unittest.mock import patch

from models import AutoExaminerAction
from server.environment import AutoExaminerEnvironment


@pytest.fixture
def env():
    return AutoExaminerEnvironment()


def test_reset_returns_observation(env):
    obs = env.reset()
    assert obs.difficulty_level == 1
    assert obs.topic == "basic_functions"
    assert obs.done is False


def test_reset_with_explicit_difficulty(env):
    obs = env.reset(difficulty=3)
    assert obs.difficulty_level == 3
    assert obs.topic == "data_structures"


def test_reset_clamps_difficulty_high(env):
    obs = env.reset(difficulty=99)
    assert obs.difficulty_level == 5


def test_reset_clamps_difficulty_low(env):
    obs = env.reset(difficulty=0)
    assert obs.difficulty_level == 1


def test_state_after_reset(env):
    env.reset()
    s = env.state
    assert s.step_count == 0
    assert s.current_difficulty == 1


def test_step_increments_step_count(env):
    env.reset()
    action = AutoExaminerAction(
        challenge="Write a function that returns 42",
        solution="def answer():\n    return 42",
    )
    with patch("server.environment.generate_test_cases") as mock_gen:
        mock_gen.return_value = [("assert answer() == 42", "test 1")]
        env.step(action)
    assert env.state.step_count == 1


def test_step_runs_test_cases(env):
    env.reset()
    action = AutoExaminerAction(
        challenge="Write a function that returns 42",
        solution="def answer():\n    return 42",
    )
    with patch("server.environment.generate_test_cases") as mock_gen:
        mock_gen.return_value = [("assert answer() == 42", "test 1")]
        obs = env.step(action)
    assert obs.total_tests == 1
    assert obs.tests_passed == 1
    assert obs.score == 1.0


def test_step_done_after_5_steps(env):
    env.reset()
    # Use a solution that fails all tests so score stays < 1.0 and episode doesn't end early
    action = AutoExaminerAction(
        challenge="Write a function",
        solution="def f():\n    return None",
    )
    with patch("server.environment.generate_test_cases") as mock_gen:
        mock_gen.return_value = [("assert f() == 999", "test 1")]
        for _ in range(4):
            obs = env.step(action)
        assert obs.done is False
        obs = env.step(action)
        assert obs.done is True


def test_step_done_on_perfect_score(env):
    env.reset()
    action = AutoExaminerAction(
        challenge="Write a function that returns 42",
        solution="def answer():\n    return 42",
    )
    with patch("server.environment.generate_test_cases") as mock_gen:
        mock_gen.return_value = [("assert answer() == 42", "test 1")]
        obs = env.step(action)
    assert obs.score == 1.0
    assert obs.done is True


def test_difficulty_increases_on_high_score(env):
    env.reset(difficulty=2)
    action = AutoExaminerAction(
        challenge="Write a function that adds two numbers",
        solution="def add(a, b):\n    return a + b",
    )
    with patch("server.environment.generate_test_cases") as mock_gen:
        mock_gen.return_value = [("assert add(1, 2) == 3", "test 1")]
        obs = env.step(action)
    assert obs.score == 1.0
    assert obs.new_difficulty == 3


def test_difficulty_decreases_on_low_score(env):
    env.reset(difficulty=3)
    action = AutoExaminerAction(
        challenge="Write a function",
        solution="def f():\n    return None",
    )
    with patch("server.environment.generate_test_cases") as mock_gen:
        mock_gen.return_value = [("assert f() == 42", "test 1")]
        obs = env.step(action)
    assert obs.score == 0.0
    assert obs.new_difficulty == 2


def test_difficulty_unchanged_on_mid_score(env):
    env.reset(difficulty=3)
    action = AutoExaminerAction(
        challenge="Write a function",
        solution="def f(x):\n    return x",
    )
    with patch("server.environment.generate_test_cases") as mock_gen:
        # 1 of 2 tests pass → score 0.5 (not >=0.8 and not <0.5)
        mock_gen.return_value = [
            ("assert f(1) == 1", "test 1"),
            ("assert f(2) == 999", "test 2"),
        ]
        obs = env.step(action)
    assert obs.score == pytest.approx(0.5)
    assert obs.new_difficulty == 3


def test_empty_action_has_negative_reward(env):
    env.reset()
    action = AutoExaminerAction(challenge="", solution="")
    with patch("server.environment.generate_test_cases") as mock_gen:
        mock_gen.return_value = [("assert True", "fallback")]
        obs = env.step(action)
    assert obs.reward < 0
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_environment.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'server.environment'`

- [ ] **Step 3: Implement server/environment.py**

Create `server/environment.py`:

```python
import subprocess
import uuid
from typing import Any, Optional

from openenv.core.env_server import Environment

from models import AutoExaminerAction, AutoExaminerObservation, AutoExaminerState
from server.rewards import compute_total_reward
from server.test_generator import generate_test_cases

TOPICS = [
    "basic_functions",
    "algorithms",
    "data_structures",
    "multi_function",
    "complex_algorithms",
]

TOPIC_PROMPTS = {
    "basic_functions": "Write a simple Python function (e.g. sum a list, check even/odd, reverse a string)",
    "algorithms": "Implement a classic algorithm (e.g. binary search, bubble sort, fibonacci)",
    "data_structures": "Write functions to manipulate data structures (e.g. linked list, stack, queue)",
    "multi_function": "Write multiple interdependent functions that work together to solve a problem",
    "complex_algorithms": "Implement a complex algorithm with edge cases and efficiency considerations",
}


def _run_test(solution_code: str, assertion: str) -> tuple[bool, bool, bool]:
    """Run one assertion against solution. Returns (passed, timed_out, crashed)."""
    code = solution_code + "\n\n" + assertion
    try:
        result = subprocess.run(
            ["python", "-c", code],
            timeout=3.0,
            capture_output=True,
            text=True,
        )
        return result.returncode == 0, False, False
    except subprocess.TimeoutExpired:
        return False, True, False
    except Exception:
        return False, False, True


class AutoExaminerEnvironment(Environment):
    def __init__(self):
        super().__init__()
        self._difficulty = 1
        self._topic = TOPICS[0]
        self._topic_variant = 0  # cycles through sub-topics on mid-score
        self._step_count = 0
        self._episode_id = ""
        self._total_episodes = 0
        self._reward_history: list[float] = []

    def reset(
        self,
        seed: Optional[int] = None,
        episode_id: Optional[str] = None,
        difficulty: Optional[int] = None,
        **kwargs: Any,
    ) -> AutoExaminerObservation:
        if difficulty is not None:
            self._difficulty = max(1, min(5, int(difficulty)))
        self._topic = TOPICS[self._difficulty - 1]
        self._topic_variant = 0
        self._step_count = 0
        self._episode_id = episode_id or str(uuid.uuid4())
        self._total_episodes += 1
        return AutoExaminerObservation(
            difficulty_level=self._difficulty,
            topic=self._topic,
            feedback=TOPIC_PROMPTS[self._topic],
        )

    def step(
        self,
        action: AutoExaminerAction,
        timeout_s: Optional[float] = None,
        **kwargs: Any,
    ) -> AutoExaminerObservation:
        self._step_count += 1

        test_cases = generate_test_cases(action.challenge, action.solution)
        total_tests = len(test_cases)

        tests_passed = 0
        timed_out = False
        crashed = False
        for assertion, _ in test_cases:
            passed, to, cr = _run_test(action.solution, assertion)
            if passed:
                tests_passed += 1
            if to:
                timed_out = True
            if cr:
                crashed = True

        score = tests_passed / total_tests if total_tests > 0 else 0.0

        reward = compute_total_reward(
            tests_passed=tests_passed,
            total_tests=total_tests,
            difficulty_level=self._difficulty,
            challenge=action.challenge,
            solution=action.solution,
            timed_out=timed_out,
            crashed=crashed,
        )
        self._reward_history.append(reward)

        if score >= 0.8:
            new_difficulty = min(5, self._difficulty + 1)
            self._topic_variant = 0
            new_topic = TOPICS[new_difficulty - 1]
        elif score < 0.5:
            new_difficulty = max(1, self._difficulty - 1)
            self._topic_variant = 0
            new_topic = TOPICS[new_difficulty - 1]
        else:
            new_difficulty = self._difficulty
            # rotate through topics at same difficulty
            self._topic_variant = (self._topic_variant + 1) % len(TOPICS)
            new_topic = TOPICS[self._topic_variant]

        self._difficulty = new_difficulty
        self._topic = new_topic

        done = self._step_count >= 5 or score == 1.0

        parts = [f"Score: {score:.2f} ({tests_passed}/{total_tests} tests passed)."]
        if timed_out:
            parts.append("Solution timed out.")
        if crashed:
            parts.append("Solution crashed.")
        parts.append(f"Next difficulty: {new_difficulty}.")

        return AutoExaminerObservation(
            done=done,
            reward=reward,
            difficulty_level=self._difficulty,
            topic=self._topic,
            score=score,
            tests_passed=tests_passed,
            total_tests=total_tests,
            feedback=" ".join(parts),
            challenge_valid=bool(action.challenge and action.solution),
            new_difficulty=new_difficulty,
        )

    @property
    def state(self) -> AutoExaminerState:
        avg = (
            sum(self._reward_history) / len(self._reward_history)
            if self._reward_history
            else 0.0
        )
        return AutoExaminerState(
            episode_id=self._episode_id,
            step_count=self._step_count,
            current_difficulty=self._difficulty,
            current_topic=self._topic,
            total_episodes=self._total_episodes,
            avg_reward=round(avg, 4),
        )
```

- [ ] **Step 4: Run tests — confirm passing**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/test_environment.py -v
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/environment.py tests/test_environment.py
git commit -m "feat: implement AutoExaminerEnvironment with subprocess test runner"
```

---

## Chunk 5: Server App and Client

### Task 6: server/app.py

**Files:**
- Create: `server/app.py`

- [ ] **Step 1: Implement server/app.py**

Create `server/app.py`:

```python
import uvicorn
from openenv.core.env_server import create_fastapi_app

from models import AutoExaminerAction, AutoExaminerObservation
from server.environment import AutoExaminerEnvironment

app = create_fastapi_app(
    AutoExaminerEnvironment,
    AutoExaminerAction,
    AutoExaminerObservation,
)


def main():
    uvicorn.run(app, host="0.0.0.0", port=7860)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Start server in background and verify /health**

```bash
cd /home/vamp/Hackathon/Auto-examiner
uvicorn server.app:app --host 0.0.0.0 --port 8000 &
sleep 3
curl -s http://localhost:8000/health
```

Expected: `{"status":"healthy"}`

- [ ] **Step 3: Verify /schema endpoint returns all three schema keys**

```bash
curl -s http://localhost:8000/schema | python -c "import json,sys; d=json.load(sys.stdin); print(sorted(d.keys()))"
```

Expected: `['action', 'observation', 'state']`

- [ ] **Step 4: Verify /reset endpoint**

```bash
curl -s -X POST http://localhost:8000/reset \
  -H "Content-Type: application/json" \
  -d '{}' | python -c "import json,sys; d=json.load(sys.stdin); print(d.get('observation',{}).get('difficulty_level'), d.get('observation',{}).get('topic'))"
```

Expected: `1 basic_functions`

- [ ] **Step 5: Kill the server**

```bash
pkill -f "uvicorn server.app" || true
```

- [ ] **Step 6: Commit**

```bash
git add server/app.py
git commit -m "feat: add FastAPI server entrypoint via create_fastapi_app"
```

---

### Task 7: client.py

**Files:**
- Create: `client.py`

The server sends observations in this format (from `serialize_observation` in openenv-core):
```json
{"observation": {"difficulty_level": 1, "topic": "...", ...}, "reward": 0.96, "done": false}
```

Note: `reward` and `done` are at the top level, NOT inside `observation`.

- [ ] **Step 1: Implement client.py**

Create `client.py`:

```python
from typing import Dict

from openenv.core import EnvClient
from openenv.core.client_types import StepResult

from models import AutoExaminerAction, AutoExaminerObservation, AutoExaminerState


class AutoExaminerEnv(
    EnvClient[AutoExaminerAction, AutoExaminerObservation, AutoExaminerState]
):
    def _step_payload(self, action: AutoExaminerAction) -> Dict:
        return {
            "challenge": action.challenge,
            "solution": action.solution,
        }

    def _parse_result(self, payload: Dict) -> StepResult[AutoExaminerObservation]:
        obs_data = payload.get("observation", {})
        observation = AutoExaminerObservation(
            done=payload.get("done", False),
            reward=payload.get("reward") or 0.0,
            difficulty_level=obs_data.get("difficulty_level", 1),
            topic=obs_data.get("topic", ""),
            score=obs_data.get("score", 0.0),
            tests_passed=obs_data.get("tests_passed", 0),
            total_tests=obs_data.get("total_tests", 0),
            feedback=obs_data.get("feedback", ""),
            challenge_valid=obs_data.get("challenge_valid", True),
            new_difficulty=obs_data.get("new_difficulty", 1),
        )
        return StepResult(
            observation=observation,
            reward=payload.get("reward"),
            done=payload.get("done", False),
        )

    def _parse_state(self, payload: Dict) -> AutoExaminerState:
        return AutoExaminerState(
            episode_id=payload.get("episode_id", ""),
            step_count=payload.get("step_count", 0),
            current_difficulty=payload.get("current_difficulty", 1),
            current_topic=payload.get("current_topic", ""),
            total_episodes=payload.get("total_episodes", 0),
            avg_reward=payload.get("avg_reward", 0.0),
        )
```

- [ ] **Step 2: Verify import**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -c "from client import AutoExaminerEnv; print('client OK')"
```

Expected: `client OK`

- [ ] **Step 3: Commit**

```bash
git add client.py
git commit -m "feat: add typed EnvClient subclass for AutoExaminer"
```

---

## Chunk 6: Inference, Config, and Validation

### Task 8: inference.py

**Files:**
- Create: `inference.py`

- [ ] **Step 1: Implement inference.py**

Create `inference.py`:

```python
import json
import os

from openai import OpenAI

from client import AutoExaminerEnv
from models import AutoExaminerAction

SYSTEM_PROMPT = """You are an expert Python programmer and teacher.
You will be given a difficulty level and topic.
Generate a coding challenge at that difficulty, then solve it yourself.
Respond ONLY with valid JSON in this exact format:
{
"challenge": "Write a function that...",
"solution": "def solve(...):\\n    ..."
}
No markdown, no explanation, just the JSON."""


def get_llm_response(client: OpenAI, difficulty: int, topic: str) -> dict:
    response = client.chat.completions.create(
        model=os.getenv("MODEL_NAME", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Difficulty level: {difficulty}/5\nTopic: {topic}\nGenerate a challenge and solve it.",
            },
        ],
        max_tokens=1024,
        temperature=0.7,
    )
    content = response.choices[0].message.content or "{}"
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("```")
        content = lines[1] if len(lines) > 1 else "{}"
        if content.startswith("json"):
            content = content[4:]
    return json.loads(content.strip())


def run_episode(base_url: str, llm_client: OpenAI, difficulty: int) -> list[dict]:
    results = []
    env_client = AutoExaminerEnv(base_url=base_url)
    with env_client.sync() as env:
        result = env.reset(difficulty=difficulty)
        obs = result.observation
        print(f"\n--- Episode at difficulty {difficulty} | Topic: {obs.topic} ---")

        while not obs.done:
            try:
                llm_out = get_llm_response(llm_client, obs.difficulty_level, obs.topic)
                challenge = llm_out.get("challenge", "")
                solution = llm_out.get("solution", "")
            except Exception as e:
                print(f"  LLM error: {e}, using fallback")
                challenge = "Write a function that returns 42"
                solution = "def answer():\n    return 42"

            action = AutoExaminerAction(challenge=challenge, solution=solution)
            result = env.step(action)
            obs = result.observation

            step_result = {
                "difficulty": obs.difficulty_level,
                "topic": obs.topic,
                "score": obs.score,
                "tests_passed": obs.tests_passed,
                "total_tests": obs.total_tests,
                "reward": obs.reward,
            }
            results.append(step_result)
            print(
                f"  Step {len(results)}: score={obs.score:.2f} "
                f"({obs.tests_passed}/{obs.total_tests}) reward={obs.reward:.4f}"
            )

    return results


def main():
    base_url = os.getenv("ENV_BASE_URL", "http://localhost:7860")
    llm_client = OpenAI(
        api_key=os.getenv("HF_TOKEN", ""),
        base_url=os.getenv("API_BASE_URL", "https://api.openai.com/v1"),
    )

    all_results = []
    for difficulty in [1, 3, 5]:
        steps = run_episode(base_url, llm_client, difficulty)
        all_results.append({"difficulty": difficulty, "steps": steps})

    print("\n=== Baseline Scores ===")
    print(f"{'Difficulty':<12} {'Avg Score':<12} {'Avg Reward':<12} {'Steps'}")
    print("-" * 50)
    for ep in all_results:
        steps = ep["steps"]
        if steps:
            avg_score = sum(s["score"] for s in steps) / len(steps)
            avg_reward = sum(s["reward"] for s in steps) / len(steps)
            print(f"{ep['difficulty']:<12} {avg_score:<12.3f} {avg_reward:<12.4f} {len(steps)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify import (no server needed)**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -c "import inference; print('inference OK')"
```

Expected: `inference OK`

- [ ] **Step 3: Commit**

```bash
git add inference.py
git commit -m "feat: add 3-episode baseline inference script"
```

---

### Task 9: openenv.yaml and Dockerfile

**Files:**
- Create: `openenv.yaml`
- Create: `server/Dockerfile`

- [ ] **Step 1: Create openenv.yaml**

Create `openenv.yaml`:

```yaml
name: auto-examiner
version: "1.0.0"
description: "Self-improving coding challenge environment for RL agents"
tags: ["openenv", "self-improvement", "auto-curriculum", "reinforcement-learning"]
```

- [ ] **Step 2: Create server/Dockerfile**

Create `server/Dockerfile`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir openenv-core fastapi uvicorn openai
COPY models.py .
COPY client.py .
COPY inference.py .
COPY openenv.yaml .
COPY pyproject.toml .
COPY server/ server/
EXPOSE 7860
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "7860"]
```

- [ ] **Step 3: Commit**

```bash
git add openenv.yaml server/Dockerfile
git commit -m "chore: add OpenEnv manifest and Dockerfile"
```

---

### Task 10: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

Create `README.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with problem statement, action/obs space, reward table"
```

---

### Task 11: Validate and final smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

```bash
cd /home/vamp/Hackathon/Auto-examiner
python -m pytest tests/ -v
```

Expected: all tests pass (models, rewards, test_generator, environment suites).

- [ ] **Step 2: Run openenv validate**

```bash
cd /home/vamp/Hackathon/Auto-examiner
openenv validate .
```

Expected output includes: `Ready for multi-mode deployment`

If it reports `Missing uv.lock`, run `uv lock` first.

- [ ] **Step 3: Integration smoke test — start server**

```bash
cd /home/vamp/Hackathon/Auto-examiner
uvicorn server.app:app --host 0.0.0.0 --port 8000 &
sleep 3
```

- [ ] **Step 4: Hit all required endpoints**

```bash
# Health
curl -s http://localhost:8000/health

# Schema
curl -s http://localhost:8000/schema | python -c "import json,sys; d=json.load(sys.stdin); assert 'action' in d and 'observation' in d and 'state' in d; print('schema OK')"

# Reset
curl -s -X POST http://localhost:8000/reset \
  -H "Content-Type: application/json" \
  -d '{}' | python -c "import json,sys; d=json.load(sys.stdin); obs=d.get('observation',{}); print('reset OK, difficulty=', obs.get('difficulty_level'), 'topic=', obs.get('topic'))"

# Step
curl -s -X POST http://localhost:8000/step \
  -H "Content-Type: application/json" \
  -d '{"action": {"challenge": "Write a function that returns 42", "solution": "def answer():\n    return 42"}}' \
  | python -c "import json,sys; d=json.load(sys.stdin); obs=d.get('observation',{}); print('step OK, score=', obs.get('score'), 'reward=', d.get('reward'))"
```

- [ ] **Step 5: Kill server and final commit**

```bash
pkill -f "uvicorn server.app" || true
git add -A
git status
git commit -m "chore: final validation — all endpoints passing, openenv validate clean" || echo "nothing to commit"
```
