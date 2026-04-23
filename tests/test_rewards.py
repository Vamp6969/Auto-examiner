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
