"""
Full document processing pipeline.
Status flow: uploaded → extracting → chunking → embedding → completed/failed
"""
import logging

import psycopg

from . import ai, embeddings, store
from .chunking import chunk_document
from .convert import ConversionError, ConversionResult, convert_to_markdown
from .db import get_conn

logger = logging.getLogger(__name__)

EMBED_BATCH = 64


def process_document(doc_id: int, filename: str, content: bytes) -> None:
    """Full pipeline for one document. Runs in background thread."""
    conn = get_conn()
    try:
        _run_pipeline(conn, doc_id, filename, content, parent_id=None)
    except Exception as exc:
        logger.exception("pipeline failed for doc %s", doc_id)
        try:
            store.set_status(conn, doc_id, "failed", str(exc)[:500])
        except Exception:
            pass
    finally:
        conn.close()


def _run_pipeline(
    conn: psycopg.Connection,
    doc_id: int,
    filename: str,
    content: bytes,
    parent_id: int | None,
) -> None:
    # 1. Extract text
    store.set_status(conn, doc_id, "extracting")
    try:
        result: ConversionResult = convert_to_markdown(filename, content)
    except ConversionError as exc:
        store.set_status(conn, doc_id, "failed", str(exc))
        return

    # 2. Summarise (best-effort — never fails pipeline)
    keywords: list[str] = []
    summary: str | None = None
    try:
        keywords, summary = ai.summarise_document(result.full_text)
    except Exception:
        pass

    store.save_extracted_text(conn, doc_id, result.full_text, keywords, summary)

    # 3. Process email attachments as child documents
    for att in result.attachments:
        try:
            child_id, created = store.upsert_document(
                conn, att.filename, att.content,
                parent_document_id=doc_id, mime_type=att.mime_type)
            if created:
                _run_pipeline(conn, child_id, att.filename, att.content,
                              parent_id=doc_id)
        except Exception as exc:
            logger.warning("attachment %s failed: %s", att.filename, exc)

    # 4. Chunk
    store.set_status(conn, doc_id, "chunking")
    chunk_results = []

    if result.pages:
        # PDF: chunk per page so page_number is accurate
        for page_num, page_text in enumerate(result.pages, start=1):
            if not page_text.strip():
                continue
            for cr in chunk_document(page_text, page_number=page_num):
                chunk_results.append(cr)
        for i, cr in enumerate(chunk_results):
            cr.chunk_index = i
    else:
        chunk_results = chunk_document(result.full_text)

    store.save_chunks(conn, doc_id, [
        {
            "chunk_index": cr.chunk_index,
            "chunk_text": cr.chunk_text,
            "token_count": cr.token_count,
            "page_number": cr.page_number,
            "section_title": cr.section_title,
            "metadata": {
                "converter": result.converter_used,
                **({"email": result.email_metadata} if result.email_metadata else {}),
                **({"parent_document_id": parent_id} if parent_id else {}),
            },
        }
        for cr in chunk_results
    ])

    # 5. Embed
    store.set_status(conn, doc_id, "embedding")
    chunk_rows = conn.execute(
        "SELECT id, chunk_text FROM document_chunks"
        " WHERE document_id=%s ORDER BY chunk_index",
        (doc_id,)).fetchall()

    updates: list[tuple[list[float], int]] = []
    for i in range(0, len(chunk_rows), EMBED_BATCH):
        batch = chunk_rows[i:i + EMBED_BATCH]
        try:
            vecs = embeddings.embed_texts([r["chunk_text"] for r in batch])
            updates.extend((vec, r["id"]) for r, vec in zip(batch, vecs))
        except embeddings.EmbeddingError as exc:
            store.set_status(conn, doc_id, "failed",
                             f"embedding batch failed: {exc}")
            return

    store.save_embeddings(conn, updates)
    store.set_status(conn, doc_id, "completed")
