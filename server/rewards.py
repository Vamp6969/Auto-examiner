"""Reward functions for the Auto-Examiner environment.

Four independent signals — kept separate so they can be tuned (or audited)
individually — combined into a single clamped scalar by `compute_total_reward`.

Range summary:
  correctness          : [0.0,  1.0]
  difficulty multiplier: [0.0,  2.0]   (correctness × (1 + level/5))
  format compliance    : [-0.2, 0.1]
  timeout penalty      : [-0.3, 0.0]
  TOTAL (clamped)      : [-1.0, 2.0]   (theoretical max with format bonus = 2.10)
"""


def reward_correctness(tests_passed: int, total_tests: int) -> float:
    """Fraction of test assertions that passed. Returns 0.0 if no tests were generated."""
    if total_tests == 0:
        return 0.0
    return tests_passed / total_tests


def reward_difficulty_multiplier(base_score: float, difficulty_level: int) -> float:
    """Scale the base correctness score by (1 + level/5). Difficulty 5 doubles it."""
    return base_score * (1 + difficulty_level / 5)


def reward_format_compliance(challenge: str, solution: str) -> float:
    """Tiny shaping signal that rewards well-formed submissions and penalises junk.

    Bonus only awarded when both fields are non-trivial AND the solution
    actually defines a function (`def`). Empty strings get the harshest penalty.
    """
    if not challenge or not solution:
        return -0.2          # empty submission — heaviest format penalty
    if len(challenge) < 10 or len(solution) < 10:
        return -0.1          # one or both fields are suspiciously short
    if "def " not in solution:
        return -0.1          # solution didn't even define a function
    return 0.1               # well-formed bonus


def reward_timeout_penalty(timed_out: bool, crashed: bool) -> float:
    """Punish solutions that hung or crashed during sandbox execution."""
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
    """Combine the four signals into a single clamped scalar in [-1.0, 2.0].

    The multiplier is applied to the correctness score *before* the additive
    format/timeout adjustments — so format and timeout signals are independent
    of difficulty (a crash penalty is the same at level 1 as at level 5).
    Result is rounded to 4 decimals for display stability.
    """
    base = reward_correctness(tests_passed, total_tests)
    scaled = reward_difficulty_multiplier(base, difficulty_level)
    fmt = reward_format_compliance(challenge, solution)
    timeout = reward_timeout_penalty(timed_out, crashed)
    total = scaled + fmt + timeout
    return round(max(-1.0, min(2.0, total)), 4)
