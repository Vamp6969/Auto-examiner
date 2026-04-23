import json
import os

from openai import OpenAI

from client import AutoExaminerEnv
from models import AutoExaminerAction

SYSTEM_PROMPT = """You are an expert Python programmer and teacher.
You will be given a difficulty level and topic.
Generate a coding challenge at that difficulty, then solve it yourself.
Respond ONLY with valid JSON in this exact format:
{
"challenge": "Write a function that...",
"solution": "def solve(...):\\n    ..."
}
No markdown, no explanation, just the JSON."""


def get_llm_response(client: OpenAI, difficulty: int, topic: str) -> dict:
    response = client.chat.completions.create(
        model=os.getenv("MODEL_NAME", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Difficulty level: {difficulty}/5\nTopic: {topic}\nGenerate a challenge and solve it.",
            },
        ],
        max_tokens=1024,
        temperature=0.7,
    )
    content = response.choices[0].message.content or "{}"
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("```")
        content = lines[1] if len(lines) > 1 else "{}"
        if content.startswith("json"):
            content = content[4:]
    return json.loads(content.strip())


def run_episode(base_url: str, llm_client: OpenAI, difficulty: int) -> list[dict]:
    results = []
    env_client = AutoExaminerEnv(base_url=base_url)
    with env_client.sync() as env:
        result = env.reset(difficulty=difficulty)
        obs = result.observation
        print(f"\n--- Episode at difficulty {difficulty} | Topic: {obs.topic} ---")

        while not obs.done:
            try:
                llm_out = get_llm_response(llm_client, obs.difficulty_level, obs.topic)
                challenge = llm_out.get("challenge", "")
                solution = llm_out.get("solution", "")
            except Exception as e:
                print(f"  LLM error: {e}, using fallback")
                challenge = "Write a function that returns 42"
                solution = "def answer():\n    return 42"

            action = AutoExaminerAction(challenge=challenge, solution=solution)
            result = env.step(action)
            obs = result.observation

            step_result = {
                "difficulty": obs.difficulty_level,
                "topic": obs.topic,
                "score": obs.score,
                "tests_passed": obs.tests_passed,
                "total_tests": obs.total_tests,
                "reward": obs.reward,
            }
            results.append(step_result)
            print(
                f"  Step {len(results)}: score={obs.score:.2f} "
                f"({obs.tests_passed}/{obs.total_tests}) reward={obs.reward:.4f}"
            )

    return results


def main():
    base_url = os.getenv("ENV_BASE_URL", "http://localhost:7860")
    llm_client = OpenAI(
        api_key=os.getenv("HF_TOKEN", ""),
        base_url=os.getenv("API_BASE_URL", "https://api.openai.com/v1"),
    )

    all_results = []
    for difficulty in [1, 3, 5]:
        steps = run_episode(base_url, llm_client, difficulty)
        all_results.append({"difficulty": difficulty, "steps": steps})

    print("\n=== Baseline Scores ===")
    print(f"{'Difficulty':<12} {'Avg Score':<12} {'Avg Reward':<12} {'Steps'}")
    print("-" * 50)
    for ep in all_results:
        steps = ep["steps"]
        if steps:
            avg_score = sum(s["score"] for s in steps) / len(steps)
            avg_reward = sum(s["reward"] for s in steps) / len(steps)
            print(f"{ep['difficulty']:<12} {avg_score:<12.3f} {avg_reward:<12.4f} {len(steps)}")


if __name__ == "__main__":
    main()
