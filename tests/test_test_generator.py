from unittest.mock import MagicMock, patch

from server.test_generator import generate_test_cases


def _make_mock_openai(content: str):
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content=content))]
    )
    return mock_client


def test_generate_returns_list_of_tuples():
    llm_output = (
        "assert add(1, 2) == 3\n"
        "assert add(0, 0) == 0\n"
        "assert add(-1, 1) == 0\n"
        "assert add(10, 5) == 15\n"
        "assert add(100, 200) == 300"
    )
    with patch("server.test_generator.OpenAI") as mock_cls:
        mock_cls.return_value = _make_mock_openai(llm_output)
        result = generate_test_cases("Write a function that adds two numbers", "def add(a, b):\n    return a + b")

    assert isinstance(result, list)
    assert len(result) >= 1
    for assertion, desc in result:
        assert isinstance(assertion, str)
        assert isinstance(desc, str)
        assert assertion.startswith("assert ")


def test_generate_at_most_5_cases():
    llm_output = "\n".join(f"assert f({i}) == {i}" for i in range(10))
    with patch("server.test_generator.OpenAI") as mock_cls:
        mock_cls.return_value = _make_mock_openai(llm_output)
        result = generate_test_cases("challenge", "def f(x): return x")

    assert len(result) <= 5


def test_fallback_on_openai_constructor_error():
    with patch("server.test_generator.OpenAI", side_effect=Exception("API error")):
        result = generate_test_cases("Write a function", "def f(): pass")

    assert isinstance(result, list)
    assert len(result) >= 1


def test_fallback_on_api_call_error():
    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = Exception("Network error")
    with patch("server.test_generator.OpenAI", return_value=mock_client):
        result = generate_test_cases("challenge", "solution")

    assert isinstance(result, list)
    assert len(result) >= 1


def test_fallback_never_empty():
    with patch("server.test_generator.OpenAI", side_effect=Exception("fail")):
        result = generate_test_cases("", "")

    assert len(result) >= 1


def test_fallback_when_no_assert_lines():
    with patch("server.test_generator.OpenAI") as mock_cls:
        mock_cls.return_value = _make_mock_openai("Here are your tests:\nTest one: pass\nTest two: fail")
        result = generate_test_cases("challenge", "def f(): pass")

    assert len(result) >= 1
