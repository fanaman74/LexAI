import hashlib
import sqlite3
from pathlib import Path


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upsert_file(conn: sqlite3.Connection, original_name: str,
                content: bytes) -> tuple[int, bool]:
    """Insert file if content is new; return (file_id, created)."""
    digest = sha256_hex(content)
    row = conn.execute("SELECT id FROM files WHERE sha256=?", (digest,)).fetchone()
    if row:
        return row["id"], False
    file_type = Path(original_name).suffix.lower().lstrip(".") or "unknown"
    try:
        cur = conn.execute(
            "INSERT INTO files (sha256, original_name, file_type, size_bytes, content)"
            " VALUES (?,?,?,?,?)",
            (digest, original_name, file_type, len(content), content))
        conn.commit()
        return cur.lastrowid, True
    except sqlite3.IntegrityError:
        # Concurrent worker inserted the same content between our SELECT and INSERT.
        conn.rollback()
        row = conn.execute("SELECT id FROM files WHERE sha256=?", (digest,)).fetchone()
        if row:
            return row["id"], False
        raise


def add_location(conn: sqlite3.Connection, file_id: int, root_folder: str,
                 subfolder_path: str, filename: str) -> None:
    # A path maps to exactly one current file version: drop stale mappings.
    conn.execute(
        "DELETE FROM file_locations WHERE root_folder=? AND subfolder_path=?"
        " AND filename=? AND file_id<>?",
        (root_folder, subfolder_path, filename, file_id))
    conn.execute(
        "INSERT OR IGNORE INTO file_locations (file_id, root_folder, subfolder_path, filename)"
        " VALUES (?,?,?,?)",
        (file_id, root_folder, subfolder_path, filename))
    conn.commit()


def save_markdown(conn: sqlite3.Connection, file_id: int, content_md: str,
                  converter_used: str) -> None:
    conn.execute(
        "INSERT INTO markdown_files (file_id, content_md, converter_used, word_count)"
        " VALUES (?,?,?,?)"
        " ON CONFLICT(file_id) DO UPDATE SET content_md=excluded.content_md,"
        " converter_used=excluded.converter_used, converted_at=datetime('now'),"
        " word_count=excluded.word_count",
        (file_id, content_md, converter_used, len(content_md.split())))
    conn.execute(
        "UPDATE files SET status='converted', error_message=NULL,"
        " updated_at=datetime('now') WHERE id=?", (file_id,))
    conn.commit()


def set_status(conn: sqlite3.Connection, file_id: int, status: str,
               error_message: str | None = None) -> None:
    conn.execute(
        "UPDATE files SET status=?, error_message=?, updated_at=datetime('now')"
        " WHERE id=?", (status, error_message, file_id))
    conn.commit()
