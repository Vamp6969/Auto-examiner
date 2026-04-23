import uvicorn
from openenv.core.env_server import create_fastapi_app

from models import AutoExaminerAction, AutoExaminerObservation
from server.environment import AutoExaminerEnvironment

app = create_fastapi_app(
    AutoExaminerEnvironment,
    AutoExaminerAction,
    AutoExaminerObservation,
)


def main():
    uvicorn.run(app, host="0.0.0.0", port=7860)


if __name__ == "__main__":
    main()
