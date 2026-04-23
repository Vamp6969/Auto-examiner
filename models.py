from openenv.core.env_server import Action, Observation, State


class AutoExaminerAction(Action):
    challenge: str = ""
    solution: str = ""


class AutoExaminerObservation(Observation):
    # done and reward are inherited from Observation base (done=False, reward=None|float)
    # We set reward default to 0.0 so observations are always numeric
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
    # step_count is inherited from State base (int=0, ge=0) — not re-declared to keep constraint
    episode_id: str = ""
    current_difficulty: int = 1
    current_topic: str = ""
    total_episodes: int = 0
    avg_reward: float = 0.0
