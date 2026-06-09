import pytest

from app.db import get_conn, init_db


@pytest.fixture
def conn(tmp_path):
    c = get_conn(tmp_path / "test.db")
    init_db(c)
    yield c
    c.close()


def test_all_tables_exist(conn):
    names = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    for t in ["files", "file_locations", "markdown_files", "tags",
              "file_tags", "notes", "analyses", "markdown_fts"]:
        assert t in names, f"missing table {t}"


def test_foreign_keys_enforced(conn):
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO file_locations (file_id, root_folder, subfolder_path, filename)"
            " VALUES (999, '/r', '', 'x.txt')")


def test_fts_triggers_sync(conn):
    conn.execute(
        "INSERT INTO files (sha256, original_name, file_type, size_bytes, content)"
        " VALUES ('h1', 'a.txt', 'txt', 3, X'616263')")
    fid = conn.execute("SELECT id FROM files").fetchone()["id"]
    conn.execute(
        "INSERT INTO markdown_files (file_id, content_md, converter_used, word_count)"
        " VALUES (?, 'indemnification clause applies', 'text', 3)", (fid,))
    rows = conn.execute(
        "SELECT rowid FROM markdown_fts WHERE markdown_fts MATCH 'indemnification'"
    ).fetchall()
    assert len(rows) == 1
    conn.execute("UPDATE markdown_files SET content_md='force majeure' WHERE file_id=?", (fid,))
    assert conn.execute(
        "SELECT count(*) c FROM markdown_fts WHERE markdown_fts MATCH 'indemnification'"
    ).fetchone()["c"] == 0
    assert conn.execute(
        "SELECT count(*) c FROM markdown_fts WHERE markdown_fts MATCH 'majeure'"
    ).fetchone()["c"] == 1
