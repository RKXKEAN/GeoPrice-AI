FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN uv pip install --system mlflow psycopg2-binary boto3

EXPOSE 5000

# ใช้ Shell form เพื่อให้ระบบสามารถแปลงค่าตัวแปร ${...} ได้
CMD mlflow server \
    --host 0.0.0.0 \
    --port 5000 \
    --allowed-hosts "*" \
    --cors-allowed-origins "*" \
    --backend-store-uri postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB} \
    --default-artifact-root s3://mlflow-artifacts/