FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir openenv-core fastapi uvicorn openai

# Backend
COPY models.py .
COPY client.py .
COPY inference.py .
COPY openenv.yaml .
COPY pyproject.toml .
COPY server/ server/

# Dashboard (served by server/app.py)
COPY index.html .
COPY styles.css .
COPY app.js .
COPY logger.js .
COPY api.js .
COPY chart.js .

EXPOSE 7860
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "7860"]
