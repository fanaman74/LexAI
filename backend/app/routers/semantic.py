# backend/app/routers/semantic.py
import json

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from pgvector.psycopg import register_vector

from .. import embeddings
from ..deps import get_db

router = APIRouter(prefix="/api")

SNIPPET_CHARS = 400
TOP_K = 20
NEIGHBOR_DISTANCE = 1  # chunks before/after to include as context


@router.get("/search")
def hybrid_search(
    q: str,
    file_type: str | None = None,
    case_id: int | None = None,
    parent_document_id: int | None = None,
    limit: int = Query(default=20, le=100),
    db=Depends(get_db),
):
    """
    Hybrid search: pgvector cosine similarity + PostgreSQL full-text search.
    Results merged using Reciprocal Rank Fusion (RRF).
    Each result includes the matched chunk, neighbouring chunks, and document metadata.
    """
    if not q.strip():
        raise HTTPException(400, "empty query")

    register_vector(db)

    # Embed the query
    try:
        query_vec = embeddings.embed_texts([q.strip()])[0]
    except embeddings.EmbeddingError as exc:
        raise HTTPException(400, str(exc))

    query_arr = np.array(query_vec, dtype=np.float32)

    # Build filter clauses (shared by both vector and FTS branches)
    filters: list[str] = ["d.processing_status = 'completed'"]
    params: dict = {"query_vec": query_arr, "limit": limit,
                    "tsquery": _safe_tsquery(q)}
    if file_type:
        filters.append("d.file_type = %(file_type)s")
        params["file_type"] = file_type
    if case_id is not None:
        filters.append(
            "EXISTS (SELECT 1 FROM case_documents cd"
            " WHERE cd.document_id=d.id AND cd.case_id=%(case_id)s)")
        params["case_id"] = case_id
    if parent_document_id is not None:
        filters.append("d.parent_document_id = %(parent_document_id)s")
        params["parent_document_id"] = parent_document_id

    where = "WHERE " + " AND ".join(filters)

    # ── Vector similarity search ──────────────────────────────────────────────
    vec_sql = f"""
        SELECT dc.id AS chunk_id, dc.document_id, dc.chunk_index,
               dc.chunk_text, dc.page_number, dc.section_title, dc.metadata,
               dc.token_count,
               1 - (dc.embedding <=> %(query_vec)s::vector) AS vec_score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        {where}
        AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> %(query_vec)s::vector
        LIMIT %(limit)s
    """

    # ── Full-text search ──────────────────────────────────────────────────────
    fts_sql = f"""
        SELECT dc.id AS chunk_id, dc.document_id, dc.chunk_index,
               dc.chunk_text, dc.page_number, dc.section_title, dc.metadata,
               dc.token_count,
               ts_rank_cd(to_tsvector('english', dc.chunk_text),
                          to_tsquery('english', %(tsquery)s)) AS fts_score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        {where}
        AND to_tsvector('english', dc.chunk_text) @@ to_tsquery('english', %(tsquery)s)
        ORDER BY fts_score DESC
        LIMIT %(limit)s
    """

    vec_rows = db.execute(vec_sql, params).fetchall()
    try:
        fts_rows = db.execute(fts_sql, params).fetchall()
    except Exception:
        fts_rows = []  # malformed tsquery

    # ── Reciprocal Rank Fusion ────────────────────────────────────────────────
    merged: dict[int, dict] = {}
    for rank, row in enumerate(vec_rows):
        cid = row["chunk_id"]
        merged[cid] = dict(row)
        merged[cid]["vec_score"] = float(row.get("vec_score") or 0)
        merged[cid]["fts_score"] = 0.0
        merged[cid]["rrf"] = 1.0 / (rank + 60)
    for rank, row in enumerate(fts_rows):
        cid = row["chunk_id"]
        if cid in merged:
            merged[cid]["rrf"] += 1.0 / (rank + 60)
            merged[cid]["fts_score"] = float(row.get("fts_score") or 0)
        else:
            merged[cid] = dict(row)
            merged[cid]["vec_score"] = 0.0
            merged[cid]["fts_score"] = float(row.get("fts_score") or 0)
            merged[cid]["rrf"] = 1.0 / (rank + 60)

    top_chunks = sorted(merged.values(), key=lambda x: x["rrf"], reverse=True)[:limit]

    # ── Fetch document metadata ───────────────────────────────────────────────
    if not top_chunks:
        return {"results": [], "query": q}

    doc_ids = list({c["document_id"] for c in top_chunks})
    doc_rows = db.execute(
        "SELECT id, original_filename, file_type, processing_status,"
        " summary, keywords, parent_document_id, storage_path"
        " FROM documents WHERE id = ANY(%s)",
        (doc_ids,)).fetchall()
    docs_by_id = {r["id"]: dict(r) for r in doc_rows}

    results = []
    for chunk in top_chunks:
        doc = docs_by_id.get(chunk["document_id"], {})

        # Neighboring chunks for legal context
        neighbors = db.execute(
            "SELECT chunk_index, chunk_text, page_number FROM document_chunks"
            " WHERE document_id=%s AND chunk_index BETWEEN %s AND %s"
            " ORDER BY chunk_index",
            (chunk["document_id"],
             chunk["chunk_index"] - NEIGHBOR_DISTANCE,
             chunk["chunk_index"] + NEIGHBOR_DISTANCE)).fetchall()

        keywords = doc.get("keywords") or []
        if isinstance(keywords, str):
            try:
                keywords = json.loads(keywords)
            except Exception:
                keywords = []

        metadata = chunk.get("metadata") or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}

        results.append({
            "chunk_id": chunk["chunk_id"],
            "document_id": chunk["document_id"],
            "original_filename": doc.get("original_filename", ""),
            "file_type": doc.get("file_type", ""),
            "parent_document_id": doc.get("parent_document_id"),
            "page_number": chunk.get("page_number"),
            "section_title": chunk.get("section_title"),
            "chunk_text": chunk["chunk_text"][:SNIPPET_CHARS],
            "vec_score": round(float(chunk.get("vec_score") or 0), 4),
            "fts_score": round(float(chunk.get("fts_score") or 0), 4),
            "rrf_score": round(chunk["rrf"], 6),
            "neighbors": [
                {
                    "chunk_index": n["chunk_index"],
                    "chunk_text": n["chunk_text"][:SNIPPET_CHARS],
                    "page_number": n["page_number"],
                }
                for n in neighbors
                if n["chunk_index"] != chunk["chunk_index"]
            ],
            "doc_summary": doc.get("summary"),
            "doc_keywords": keywords,
            "email_metadata": metadata.get("email"),
        })

    return {"results": results, "query": q}


def _safe_tsquery(q: str) -> str:
    """Convert free text to a safe OR-joined tsquery string."""
    words = [w.strip() for w in q.split() if w.strip().isalpha()]
    if not words:
        return "document"  # fallback that won't error
    return " | ".join(words)
