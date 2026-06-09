import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import embeddings, indexer, vectors
from ..deps import get_db

router = APIRouter(prefix="/api")

SNIPPET_CHARS = 300
TOP_K = 12


@router.post("/index")
def run_index(request: Request):
    started = indexer.start(request.app.state.db_path)
    return {"started": started}


@router.get("/index/status")
def index_status():
    return indexer.status()


@router.get("/semantic-search")
def semantic_search(q: str, db: sqlite3.Connection = Depends(get_db)):
    if not q.strip():
        raise HTTPException(400, "empty query")
    try:
        query_vec = embeddings.embed_texts([q.strip()])[0]
    except embeddings.EmbeddingError as exc:
        raise HTTPException(400, str(exc))

    indexed = db.execute(
        "SELECT count(*) c FROM chunks WHERE embedding IS NOT NULL").fetchone()["c"]
    if indexed == 0:
        raise HTTPException(400, "no documents indexed yet — run indexing first")

    results: dict[int, dict] = {}
    for chunk_id, score in vectors.search(db, query_vec, k=TOP_K):
        row = db.execute(
            "SELECT c.text, c.file_id, f.original_name, f.file_type"
            " FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id=?",
            (chunk_id,)).fetchone()
        if row is None or row["file_id"] in results:
            continue
        results[row["file_id"]] = {
            "file_id": row["file_id"],
            "original_name": row["original_name"],
            "file_type": row["file_type"],
            "score": round(score, 4),
            "snippet": row["text"][:SNIPPET_CHARS],
        }
    return {"results": list(results.values())}
