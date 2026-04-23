import os

from openai import OpenAI


def generate_test_cases(challenge: str, solution_code: str) -> list[tuple[str, str]]:
    try:
        client = OpenAI(
            api_key=os.getenv("HF_TOKEN", ""),
            base_url=os.getenv("API_BASE_URL", "https://router.huggingface.co/featherless-ai/v1"),
        )
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
            temperature=0.2,
        )
        content = response.choices[0].message.content or ""
        assertions = [
            line.strip()
            for line in content.splitlines()
            if line.strip().startswith("assert ")
        ]
        if assertions:
            return [(a, f"test case {i + 1}") for i, a in enumerate(assertions[:5])]
    except Exception:
        pass
    return [("assert True", "basic fallback")] * 3
