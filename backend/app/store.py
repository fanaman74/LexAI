import hashlib
import json
import os
from pathlib import Path

import psycopg

_FILES_DIR = Path(os.environ.get("FILES_DIR", "data/files"))


def _files_dir() -> Path:
    d = _FILES_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_file_to_disk(content: bytes, doc_id: int, filename: str) -> str:
    """Save file bytes under data/files/{doc_id}/filename. Returns relative path."""
    dest = _files_dir() / str(doc_id) / filename
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(content)
    return str(dest)


def upsert_document(
    conn: psycopg.Connection,
    original_filename: str,
    content: bytes,
    parent_document_id: int | None = None,
    mime_type: str | None = None,
) -> tuple[int, bool]:
    """Insert document if hash is new. Returns (doc_id, created)."""
    digest = sha256_hex(content)
    row = conn.execute(
        "SELECT id FROM documents WHERE file_hash=%s", (digest,)).fetchone()
    if row:
        return row["id"], False

    file_type = Path(original_filename).suffix.lower().lstrip(".") or "unknown"
    row = conn.execute(
        "INSERT INTO documents"
        " (parent_document_id, original_filename, file_type, mime_type, file_size, file_hash)"
        " VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
        (parent_document_id, original_filename, file_type, mime_type,
         len(content), digest)).fetchone()
    conn.commit()
    doc_id = row["id"]

    storage_path = save_file_to_disk(content, doc_id, original_filename)
    conn.execute(
        "UPDATE documents SET storage_path=%s WHERE id=%s",
        (storage_path, doc_id))
    conn.commit()
    return doc_id, True


def add_location(
    conn: psycopg.Connection,
    doc_id: int,
    root_folder: str,
    subfolder_path: str,
    filename: str,
) -> None:
    conn.execute(
        "DELETE FROM document_locations"
        " WHERE root_folder=%s AND subfolder_path=%s AND filename=%s AND document_id<>%s",
        (root_folder, subfolder_path, filename, doc_id))
    conn.execute(
        "INSERT INTO document_locations (document_id, root_folder, subfolder_path, filename)"
        " VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
        (doc_id, root_folder, subfolder_path, filename))
    conn.commit()


def set_status(
    conn: psycopg.Connection,
    doc_id: int,
    status: str,
    error: str | None = None,
) -> None:
    if status == "completed":
        conn.execute(
            "UPDATE documents SET processing_status=%s, processing_error=%s,"
            " processed_at=NOW() WHERE id=%s",
            (status, error, doc_id))
    else:
        conn.execute(
            "UPDATE documents SET processing_status=%s, processing_error=%s WHERE id=%s",
            (status, error, doc_id))
    conn.commit()


def save_extracted_text(
    conn: psycopg.Connection,
    doc_id: int,
    text: str,
    keywords: list[str] | None = None,
    summary: str | None = None,
) -> None:
    conn.execute(
        "UPDATE documents SET extracted_text=%s, keywords=%s, summary=%s WHERE id=%s",
        (text, json.dumps(keywords or []), summary, doc_id))
    conn.commit()


def save_chunks(
    conn: psycopg.Connection,
    doc_id: int,
    chunks: list[dict],
) -> None:
    """Replace all chunks for doc_id. Each dict: chunk_index, chunk_text, token_count, page_number, section_title, metadata."""
    conn.execute("DELETE FROM document_chunks WHERE document_id=%s", (doc_id,))
    if not chunks:
        return
    conn.executemany(
        "INSERT INTO document_chunks"
        " (document_id, chunk_index, chunk_text, token_count, page_number, section_title, metadata)"
        " VALUES (%(document_id)s, %(chunk_index)s, %(chunk_text)s,"
        "         %(token_count)s, %(page_number)s, %(section_title)s, %(metadata)s)",
        [{"document_id": doc_id,
          "chunk_index": c["chunk_index"],
          "chunk_text": c["chunk_text"],
          "token_count": c.get("token_count"),
          "page_number": c.get("page_number"),
          "section_title": c.get("section_title"),
          "metadata": json.dumps(c.get("metadata") or {})}
         for c in chunks])
    conn.commit()


def save_embeddings(
    conn: psycopg.Connection,
    chunk_updates: list[tuple[list[float], int]],
) -> None:
    """Store embedding vectors for chunks. chunk_updates = [(vector, chunk_id), ...]"""
    from pgvector.psycopg import register_vector
    import numpy as np
    register_vector(conn)
    for vec, chunk_id in chunk_updates:
        conn.execute(
            "UPDATE document_chunks SET embedding=%s WHERE id=%s",
            (np.array(vec, dtype=np.float32), chunk_id))
    conn.commit()
