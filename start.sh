#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating Python venv…"
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r backend/requirements.txt

if [ ! -d frontend/dist ]; then
  echo "Building frontend…"
  (cd frontend && npm install && npm run build)
fi

if [ -f .env ]; then
  set -a; source .env; set +a
fi

(sleep 2 && open http://localhost:8000) &
cd backend && exec uvicorn app.main:app --host 127.0.0.1 --port 8000
