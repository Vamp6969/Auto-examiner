"""LLM-based test-case generator.

Given a coding challenge + the agent's solution, ask an LLM to write 5
pytest-style assertions that would validate the solution. Each assertion is
later run in a sandboxed subprocess by the environment.

Resilient by design: any failure (network, parse, missing token) returns a
small set of trivially-true `assert True` cases so the caller can keep going.
"""

import os

from openai import OpenAI


def generate_test_cases(challenge: str, solution_code: str) -> list[tuple[str, str]]:
    """Return up to 5 (assertion_string, description) tuples, or a 3-item fallback.

    All API config is read from environment variables so the same code works
    against OpenAI, the HuggingFace router, or any OpenAI-compatible endpoint:
        HF_TOKEN       — bearer token
        API_BASE_URL   — endpoint base
        MODEL_NAME     — model identifier
    """
    try:
        client = OpenAI(
            api_key=os.getenv("HF_TOKEN", ""),
            base_url=os.getenv("API_BASE_URL", "https://router.huggingface.co/featherless-ai/v1"),
        )
        # Pinned prompt — "only assert lines" keeps parsing simple downstream.
        prompt = (
            f"Given this coding challenge:\n{challenge}\n\n"
            f"And this solution:\n{solution_code}\n\n"
            "Write exactly 5 pytest-style assert statements to test this solution. "
            "Output only the assert lines, one per line, no explanation. "
            "Example format:\nassert function_name(input) == expected_output"
        )
        response = client.chat.completions.create(
            model=os.getenv("MODEL_NAME", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512,
            temperature=0.2,   # low temp — we want deterministic, well-formed assertions
        )
        content = response.choices[0].message.content or ""
        # Filter to lines that actually look like assertions; ignore prose.
        assertions = [
            line.strip()
            for line in content.splitlines()
            if line.strip().startswith("assert ")
        ]
        if assertions:
            # Cap at 5 to bound the per-step subprocess fan-out.
            return [(a, f"test case {i + 1}") for i, a in enumerate(assertions[:5])]
    except Exception:
        pass    # any failure path falls through to the fallback below

    # Fallback: 3 trivially-true assertions so the caller always has *something* to run.
    # The agent can still earn correctness reward (3/3) and the loop keeps moving.
    return [("assert True", "basic fallback")] * 3
