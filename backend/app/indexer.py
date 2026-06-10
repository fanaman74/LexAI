import threading

from . import vectors
from .chunking import chunk_markdown
from .db import get_conn
from .embeddings import EmbeddingError, embed_texts

BATCH = 64

_LOCK = threading.Lock()
_STATE = {"status": "idle", "total": 0, "indexed": 0, "failed": 0, "error": None}


def status() -> dict:
    with _LOCK:
        return dict(_STATE)


def start(db_path: str) -> bool:
    """Start a background index run. Returns False if one is already running."""
    with _LOCK:
        if _STATE["status"] == "running":
            return False
        _STATE.update(status="running", total=0, indexed=0, failed=0, error=None)
    threading.Thread(target=_run, args=(db_path,), daemon=True).start()
    return True


def _backfill_chunks(conn) -> None:
    """Chunk converted files that predate the chunks table (v1.0 data)."""
    rows = conn.execute(
        "SELECT m.file_id, m.content_md FROM markdown_files m"
        " LEFT JOIN chunks c ON c.file_id = m.file_id"
        " WHERE c.id IS NULL").fetchall()
    for row in rows:
        conn.executemany(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?,?,?)",
            [(row["file_id"], i, text)
             for i, text in enumerate(chunk_markdown(row["content_md"]))])
    conn.commit()


def _run(db_path: str):
    conn = get_conn(db_path)
    try:
        _backfill_chunks(conn)
        rows = conn.execute(
            "SELECT id, text FROM chunks WHERE embedding IS NULL ORDER BY id"
        ).fetchall()
        with _LOCK:
            _STATE["total"] = len(rows)
        for i in range(0, len(rows), BATCH):
            batch = rows[i:i + BATCH]
            try:
                vecs = embed_texts([r["text"] for r in batch])
                for row, vec in zip(batch, vecs):
                    vectors.upsert(conn, row["id"], vec)
                with _LOCK:
                    _STATE["indexed"] += len(batch)
            except EmbeddingError as exc:
                with _LOCK:
                    _STATE["failed"] += len(batch)
                    _STATE["error"] = str(exc)
        with _LOCK:
            _STATE["status"] = "done"
    except Exception as exc:
        with _LOCK:
            _STATE.update(status="done", error=str(exc))
    finally:
        conn.close()
