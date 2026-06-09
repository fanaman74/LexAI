import json
import sqlite3

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import ai
from ..deps import get_db

router = APIRouter(prefix="/api")


class AnalysisRequest(BaseModel):
    file_ids: list[int]
    prompt: str


@router.post("/analyses")
def create_analysis(body: AnalysisRequest, db: sqlite3.Connection = Depends(get_db)):
    if not body.file_ids or not body.prompt.strip():
        raise HTTPException(400, "file_ids and prompt are required")
    try:
        return ai.run_analysis(db, body.file_ids, body.prompt.strip())
    except ai.AnalysisError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"OpenRouter error: {exc}")


@router.get("/analyses")
def list_analyses(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT id, file_ids, prompt, response, model, created_at"
        " FROM analyses ORDER BY created_at DESC, id DESC LIMIT 100").fetchall()
    analyses = []
    for r in rows:
        d = dict(r)
        d["file_ids"] = json.loads(d["file_ids"])
        analyses.append(d)
    return {"analyses": analyses}
