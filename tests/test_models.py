from models import AutoExaminerAction, AutoExaminerObservation, AutoExaminerState


def test_action_defaults():
    a = AutoExaminerAction()
    assert a.challenge == ""
    assert a.solution == ""


def test_action_with_values():
    a = AutoExaminerAction(challenge="Write a function", solution="def f(): pass")
    assert a.challenge == "Write a function"
    assert a.solution == "def f(): pass"


def test_observation_defaults():
    obs = AutoExaminerObservation()
    assert obs.done is False
    assert obs.reward == 0.0
    assert obs.difficulty_level == 1
    assert obs.topic == ""
    assert obs.score == 0.0
    assert obs.tests_passed == 0
    assert obs.total_tests == 0
    assert obs.feedback == ""
    assert obs.challenge_valid is True
    assert obs.new_difficulty == 1


def test_state_defaults():
    s = AutoExaminerState()
    assert s.step_count == 0
    assert s.current_difficulty == 1
    assert s.current_topic == ""
    assert s.total_episodes == 0
    assert s.avg_reward == 0.0
