"""FastAPI server entrypoint.

`create_fastapi_app` from openenv-core wires together:
  - WebSocket /ws session protocol (action ↔ observation messages)
  - REST /reset, /step, /state, /health, /schema endpoints
  - JSON serialisation for the typed Action / Observation models

We additionally mount the live dashboard (index.html + js/css) at the root
URL so opening the HF Space loads the cyberpunk UI directly — no need to run
the static files locally. The OpenEnv API endpoints stay where they are; we
only intercept GET / and serve named asset files.

`main()` is the script-mode entrypoint registered in pyproject.toml as
`server = "server.app:main"`. Hugging Face Spaces and Docker both invoke
this via uvicorn on port 7860 (HF Spaces' default exposed port).
"""

from pathlib import Path

import uvicorn
from fastapi.responses import FileResponse, Response
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

# ---------------------------------------------------------------------------
# Static dashboard wiring
# ---------------------------------------------------------------------------
# In Docker / HF Space the working directory is /app and the UI files sit
# next to this server directory.
ROOT = Path(__file__).resolve().parent.parent

# Each entry maps a URL path → (filesystem path, MIME type).
DASHBOARD_FILES = {
    "/":            (ROOT / "index.html",   "text/html"),
    "/index.html":  (ROOT / "index.html",   "text/html"),
    "/styles.css":  (ROOT / "styles.css",   "text/css"),
    "/app.js":      (ROOT / "app.js",       "application/javascript"),
    "/logger.js":   (ROOT / "logger.js",    "application/javascript"),
    "/api.js":      (ROOT / "api.js",       "application/javascript"),
    "/chart.js":    (ROOT / "chart.js",     "application/javascript"),
}


def _make_handler(file_path: Path, media_type: str):
    """Build a tiny GET handler that streams the requested file."""
    async def _handler():
        if not file_path.exists():
            return Response(content=f"missing {file_path.name}", status_code=404)
        return FileResponse(file_path, media_type=media_type)
    return _handler


# Register every dashboard route directly on the existing FastAPI app.
# Doing it this way (rather than mounting a StaticFiles instance at "/")
# keeps the OpenEnv-supplied routes (/reset, /step, /health, /schema, /ws)
# unaffected — only these specific paths are intercepted.
for _path, (_fs_path, _mime) in DASHBOARD_FILES.items():
    app.add_api_route(_path, _make_handler(_fs_path, _mime), methods=["GET"])


def main():
    """Run the FastAPI app under uvicorn. Used as the package entry point."""
    uvicorn.run(app, host="0.0.0.0", port=7860)


if __name__ == "__main__":
    main()
