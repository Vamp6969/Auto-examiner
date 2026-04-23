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
