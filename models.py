"""Pydantic data models exchanged between the OpenEnv server and clients.

Three classes:
- AutoExaminerAction: what the agent submits each step (a coding challenge + solution).
- AutoExaminerObservation: what the env returns after grading the submission.
- AutoExaminerState: a snapshot of episode-wide counters/state.

All inherit from openenv-core base classes so they slot into the standard
WebSocket protocol without further wiring.
"""

from openenv.core.env_server import Action, Observation, State


class AutoExaminerAction(Action):
    # The agent writes BOTH the problem and the solution.
    challenge: str = ""   # natural-language problem statement
    solution: str = ""    # Python code that solves the challenge


class AutoExaminerObservation(Observation):
    # done and reward are inherited from the Observation base (done=False, reward=None|float).
    # We re-declare reward with a default of 0.0 so observations always carry a numeric value
    # (the base default is None, which complicates client-side rendering).
    reward: float = 0.0
    difficulty_level: int = 1     # 1..5 — current difficulty for this episode
    topic: str = ""               # topic hint chosen by the env (e.g. "algorithms")
    score: float = 0.0            # fraction of LLM-generated tests that passed (0.0..1.0)
    tests_passed: int = 0
    total_tests: int = 0
    feedback: str = ""            # human-readable summary used in UI / logs
    challenge_valid: bool = True  # False if challenge or solution was empty
    new_difficulty: int = 1       # what the difficulty will be next step (after escalation rule)


class AutoExaminerState(State):
    # step_count is inherited from State base (int=0, ge=0).
    # We do NOT re-declare it so the ge=0 constraint from the parent is preserved.
    episode_id: str = ""
    current_difficulty: int = 1
    current_topic: str = ""
    total_episodes: int = 0       # lifetime counter across resets
    avg_reward: float = 0.0       # rolling mean of all rewards in this env's history
