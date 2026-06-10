# backend/app/routers/search.py
from fastapi import APIRouter, Depends, HTTPException
from ..deps import get_db

router = APIRouter(prefix="/api")


@router.get("/keyword-search")
def keyword_search(q: str, db=Depends(get_db)):
    """Keyword search over extracted document text using PostgreSQL FTS."""
    if not q.strip():
        raise HTTPException(400, "empty query")
    safe_q = " | ".join(w for w in q.split() if w.strip().isalpha()) or "document"
    try:
        rows = db.execute(
            """SELECT d.id AS file_id, d.original_filename, d.file_type,
                      d.processing_status AS status,
                      LEFT(d.extracted_text, 400) AS snippet
               FROM documents d
               WHERE to_tsvector('english', COALESCE(d.extracted_text,''))
                     @@ to_tsquery('english', %s)
               ORDER BY ts_rank_cd(
                   to_tsvector('english', COALESCE(d.extracted_text,'')),
                   to_tsquery('english', %s)
               ) DESC
               LIMIT 50""",
            (safe_q, safe_q)).fetchall()
    except Exception:
        return {"results": []}
    return {"results": [dict(r) for r in rows]}
