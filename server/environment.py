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
            ["python3", "-c", code],
            timeout=3.0,
            capture_output=True,
            text=True,
        )
        return result.returncode == 0, False, False
    except subprocess.TimeoutExpired:
        return False, True, False
    except subprocess.SubprocessError:
        return False, False, True


class AutoExaminerEnvironment(Environment):
    def __init__(self):
        super().__init__()
        self._difficulty = 1
        self._topic = TOPICS[0]
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
        if not test_cases:
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

        tests_passed = 0
        timed_out = False
        crashed = False

        # Skip test execution for empty submissions
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
            new_topic = TOPICS[new_difficulty - 1]
        elif score < 0.5:
            new_difficulty = max(1, self._difficulty - 1)
            new_topic = TOPICS[new_difficulty - 1]
        else:
            new_difficulty = self._difficulty
            new_topic = self._topic  # keep same topic, difficulty unchanged

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
