#!/bin/sh
set -e

PORT="${PORT:-8000}"
echo "Starting Enterprise RAG API on port ${PORT}..."

exec python -m uvicorn apps.api.app.main:app --host 0.0.0.0 --port "${PORT}" --app-dir backend --workers 1
