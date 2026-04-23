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
