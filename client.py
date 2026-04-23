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
            reward=payload.get("reward", 0.0),
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
            reward=payload.get("reward", 0.0),
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
