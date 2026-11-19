# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --upgrade pip setuptools wheel
RUN pip install --prefix=/install \
    "fastapi>=0.111.0" \
    "uvicorn[standard]>=0.30.0" \
    "sqlalchemy>=2.0.30" \
    "alembic>=1.13.1" \
    "pydantic>=2.7.4" \
    "pydantic-settings>=2.3.4" \
    "asyncpg>=0.29.0" \
    "psycopg[binary]>=3.1.19" \
    "aiosqlite>=0.20.0" \
    "bcrypt>=4.1.3" \
    "pyjwt[crypto]>=2.8.0" \
    "email-validator>=2.1.0" \
    "qdrant-client>=1.12.0" \
    "fastembed>=0.4.0" \
    "groq>=0.11.0" \
    "httpx>=0.27.0" \
    "langgraph>=0.2.0" \
    "tiktoken>=0.7.0" \
    "redis>=5.0.0" \
    "python-multipart>=0.0.9" \
    "PyMuPDF>=1.24.0" \
    "python-docx>=1.1.0" \
    "openpyxl>=3.1.0" \
    "pandas>=2.2.0"

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# Copy application source, configs, and startup script
COPY backend/ ./backend/
COPY pyproject.toml .
COPY alembic.ini .
COPY start.sh .

# Ensure cache directories exist and are writable
ENV FASTEMBED_CACHE_PATH=/tmp/cache
ENV HF_HOME=/tmp/cache
RUN mkdir -p /tmp/cache && chmod -R 777 /tmp/cache
RUN chmod +x start.sh

ENV PORT=8000
EXPOSE 8000

CMD ["./start.sh"]
