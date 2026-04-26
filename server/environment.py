"""Core OpenEnv environment for Auto-Examiner.

The agent submits a (challenge, solution) pair every step. We:
  1. Ask an LLM (test_generator) to produce up to 5 pytest assertions.
  2. Run each assertion against the solution in a sandboxed subprocess.
  3. Score the solution and combine four reward signals (rewards.py).
  4. Adjust difficulty for the next step based on the score.

Episodes terminate after 5 steps or on a perfect score (1.0).
"""

import subprocess
import uuid
from typing import Any, Optional

from openenv.core.env_server import Environment

from models import AutoExaminerAction, AutoExaminerObservation, AutoExaminerState
from server.rewards import compute_total_reward
from server.test_generator import generate_test_cases

# Topic catalog — index i corresponds to difficulty level i+1.
TOPICS = [
    "basic_functions",
    "algorithms",
    "data_structures",
    "multi_function",
    "complex_algorithms",
]

# Human-readable hint included in the reset observation's feedback field —
# mostly for the agent's prompt context.
TOPIC_PROMPTS = {
    "basic_functions": "Write a simple Python function (e.g. sum a list, check even/odd, reverse a string)",
    "algorithms": "Implement a classic algorithm (e.g. binary search, bubble sort, fibonacci)",
    "data_structures": "Write functions to manipulate data structures (e.g. linked list, stack, queue)",
    "multi_function": "Write multiple interdependent functions that work together to solve a problem",
    "complex_algorithms": "Implement a complex algorithm with edge cases and efficiency considerations",
}


def _run_test(solution_code: str, assertion: str) -> tuple[bool, bool, bool]:
    """Run one assertion against `solution_code` in a fresh Python subprocess.

    Returns a (passed, timed_out, crashed) tuple. Subprocess isolation guards
    the server against agent code that might import dangerous modules, mutate
    state, or run forever (3-second hard cap).
    """
    code = solution_code + "\n\n" + assertion
    try:
        result = subprocess.run(
            ["python3", "-c", code],
            timeout=3.0,
            capture_output=True,
            text=True,
        )
        # Non-zero return code means the assertion failed (raised AssertionError).
        return result.returncode == 0, False, False
    except subprocess.TimeoutExpired:
        return False, True, False     # timed_out
    except subprocess.SubprocessError:
        return False, False, True     # any other subprocess failure -> crashed


class AutoExaminerEnvironment(Environment):
    """OpenEnv environment driving the auto-curriculum loop."""

    def __init__(self):
        super().__init__()
        # Per-environment-instance state (resets on container restart, not on /reset)
        self._difficulty = 1
        self._topic = TOPICS[0]
        self._step_count = 0
        self._episode_id = ""
        self._total_episodes = 0
        self._reward_history: list[float] = []   # for avg_reward in state

    def reset(
        self,
        seed: Optional[int] = None,
        episode_id: Optional[str] = None,
        difficulty: Optional[int] = None,
        **kwargs: Any,
    ) -> AutoExaminerObservation:
        """Start a new episode.

        Optional `difficulty` lets the client (e.g. the dashboard) pin the level
        explicitly — useful since the server may not retain difficulty across
        independent /reset calls.
        """
        if difficulty is not None:
            # Clamp into the supported [1, 5] range
            self._difficulty = max(1, min(5, int(difficulty)))
        self._topic = TOPICS[self._difficulty - 1]
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
        """Grade one (challenge, solution) submission and adjust difficulty.

        Flow:
          - Ask LLM for assertions
          - Run each assertion in a subprocess
          - Compute reward from four signals
          - Apply difficulty escalation rule (>=0.8 up, <0.5 down, else same)
          - Return done=True if step_count >= 5 OR a perfect score
        """
        self._step_count += 1

        # Generate test cases — falls back internally if LLM call fails.
        test_cases = generate_test_cases(action.challenge, action.solution)
        if not test_cases:
            # Defensive: should never happen given the fallback, but guard anyway.
            return AutoExaminerObservation(
                done=False,
                reward=-1.0,
                difficulty_level=self._difficulty,
                topic=self._topic,
                score=0.0,
                tests_passed=0,
                total_tests=0,
                feedback="Test generation failed; no tests available.",
                challenge_valid=bool(action.challenge and action.solution),
                new_difficulty=self._difficulty,
            )
        total_tests = len(test_cases)

        # Run each assertion. For empty submissions skip execution entirely
        # — they can't pass anything and we don't want to waste subprocess overhead.
        tests_passed = 0
        timed_out = False
        crashed = False
        if action.challenge and action.solution:
            for assertion, _ in test_cases:
                passed, to, cr = _run_test(action.solution, assertion)
                if passed:
                    tests_passed += 1
                if to:
                    timed_out = True
                if cr:
                    crashed = True

        score = tests_passed / total_tests if total_tests > 0 else 0.0

        # Combine the four reward signals (correctness, difficulty mult, format, timeout).
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

        # Difficulty escalation rule:
        #   ≥ 0.8 → bump up (cap 5), pick that level's topic
        #   < 0.5 → drop down (floor 1), pick that level's topic
        #   else  → hold steady, keep same topic
        if score >= 0.8:
            new_difficulty = min(5, self._difficulty + 1)
            new_topic = TOPICS[new_difficulty - 1]
        elif score < 0.5:
            new_difficulty = max(1, self._difficulty - 1)
            new_topic = TOPICS[new_difficulty - 1]
        else:
            new_difficulty = self._difficulty
            new_topic = self._topic

        self._difficulty = new_difficulty
        self._topic = new_topic

        # Episode ends after 5 steps (max episode length) or on a perfect score.
        done = self._step_count >= 5 or score == 1.0

        # Compose human-readable feedback string for the client UI.
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
        """Snapshot of the env's running state — exposed by /state endpoint."""
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
