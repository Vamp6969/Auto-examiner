"""FastAPI server entrypoint.

`create_fastapi_app` from openenv-core wires together:
  - WebSocket /ws session protocol (action ↔ observation messages)
  - REST /reset, /step, /state, /health, /schema endpoints
  - JSON serialisation for the typed Action / Observation models

`main()` is the script-mode entrypoint registered in pyproject.toml as
`server = "server.app:main"`. Hugging Face Spaces and Docker both invoke
this via uvicorn on port 7860 (HF Spaces' default exposed port).
"""

import uvicorn
from openenv.core.env_server import create_fastapi_app

from models import AutoExaminerAction, AutoExaminerObservation
from server.environment import AutoExaminerEnvironment

# The factory binds the environment class to the action/observation types
# so the framework knows how to deserialise inbound JSON and validate it.
app = create_fastapi_app(
    AutoExaminerEnvironment,
    AutoExaminerAction,
    AutoExaminerObservation,
)


def main():
    """Run the FastAPI app under uvicorn. Used as the package entry point."""
    uvicorn.run(app, host="0.0.0.0", port=7860)


if __name__ == "__main__":
    main()
