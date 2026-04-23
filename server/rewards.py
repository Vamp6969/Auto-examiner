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
