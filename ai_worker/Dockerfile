FROM python:3.12-slim

RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml ./
RUN UV_HTTP_TIMEOUT=300 uv pip install --system torch torchvision --index-url https://download.pytorch.org/whl/cu121 && \
    UV_HTTP_TIMEOUT=300 uv pip install --system -r pyproject.toml

COPY . .

CMD ["arq", "worker.WorkerSettings"]