"""Vector storage and KNN search over chunk embeddings.

Embeddings are always written to chunks.embedding (float32 bytes) as the
source of truth. When the sqlite-vec extension can be loaded, a vec0
virtual table (chunk_vectors) accelerates KNN with cosine distance;
otherwise search falls back to numpy brute-force cosine similarity.
"""
import sqlite3

import numpy as np


def _try_load_vec(conn: sqlite3.Connection) -> bool:
    try:
        import sqlite_vec
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return True
    except Exception:
        return False


def _to_blob(vec) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def upsert(conn: sqlite3.Connection, chunk_id: int, vec: list[float]) -> None:
    conn.execute("UPDATE chunks SET embedding=? WHERE id=?",
                 (_to_blob(vec), chunk_id))
    if _try_load_vec(conn):
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0("
            f"chunk_id integer primary key, embedding float[{len(vec)}] "
            "distance_metric=cosine)")
        conn.execute("DELETE FROM chunk_vectors WHERE chunk_id=?", (chunk_id,))
        conn.execute("INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (?,?)",
                     (chunk_id, _to_blob(vec)))
    conn.commit()


def delete_for_file(conn: sqlite3.Connection, file_id: int) -> None:
    if _try_load_vec(conn) and _vec_table_exists(conn):
        conn.execute(
            "DELETE FROM chunk_vectors WHERE chunk_id IN"
            " (SELECT id FROM chunks WHERE file_id=?)", (file_id,))
    conn.execute("UPDATE chunks SET embedding=NULL WHERE file_id=?", (file_id,))
    conn.commit()


def _vec_table_exists(conn: sqlite3.Connection) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE name='chunk_vectors'").fetchone() is not None


def search(conn: sqlite3.Connection, vec: list[float], k: int) -> list[tuple[int, float]]:
    """Return [(chunk_id, cosine_similarity)] for the k nearest chunks."""
    if _try_load_vec(conn) and _vec_table_exists(conn):
        rows = conn.execute(
            "SELECT chunk_id, distance FROM chunk_vectors"
            " WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (_to_blob(vec), k)).fetchall()
        return [(r["chunk_id"], 1.0 - r["distance"]) for r in rows]

    rows = conn.execute(
        "SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL").fetchall()
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    matrix = np.stack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
    query = np.asarray(vec, dtype=np.float32)
    sims = (matrix @ query) / (
        np.linalg.norm(matrix, axis=1) * np.linalg.norm(query) + 1e-12)
    top = np.argsort(-sims)[:k]
    return [(ids[i], float(sims[i])) for i in top]
