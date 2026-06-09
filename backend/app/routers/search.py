import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_db

router = APIRouter(prefix="/api")


@router.get("/search")
def search(q: str, db: sqlite3.Connection = Depends(get_db)):
    if not q.strip():
        raise HTTPException(400, "empty query")
    sql = """
      SELECT f.id AS file_id, f.original_name, f.file_type, f.status,
             snippet(markdown_fts, 0, '<mark>', '</mark>', ' … ', 16) AS snippet
      FROM markdown_fts
      JOIN markdown_files m ON m.id = markdown_fts.rowid
      JOIN files f ON f.id = m.file_id
      WHERE markdown_fts MATCH ?
      ORDER BY rank LIMIT 50"""
    try:
        rows = db.execute(sql, (q,)).fetchall()
    except sqlite3.OperationalError:
        return {"results": []}  # malformed FTS syntax from user input
    return {"results": [dict(r) for r in rows]}
