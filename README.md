# LexAIv2 — Local Legal File Analysis

Local webapp for a legal office: ingest folders of legal files (PDF/DOCX/DOC/
MSG/EML/XLSX/CSV/TXT/RTF), store originals + Markdown conversions in SQLite,
then filter by folder, full-text search, tag, annotate, and run AI analysis.

Everything runs and stays on this machine (`data/lexai.db`), except AI
analysis, which sends selected document text to OpenRouter.

## Setup (once)

```bash
brew install tesseract ocrmypdf     # OCR for scanned PDFs
cp .env.example .env                # add your OPENROUTER_API_KEY
```

## Run

```bash
./start.sh                          # opens http://localhost:8000
```

## Develop

```bash
source .venv/bin/activate
cd backend && pytest                # tests
uvicorn app.main:app --reload       # backend on :8000
cd frontend && npm run dev          # hot-reload UI (proxies /api to :8000)
```

Spec: `docs/superpowers/specs/2026-06-09-lexaiv2-design.md`
Plan: `docs/superpowers/plans/2026-06-09-lexaiv2.md`
