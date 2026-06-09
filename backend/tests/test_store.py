import pytest

from app import store
from app.db import get_conn, init_db


@pytest.fixture
def conn(tmp_path):
    c = get_conn(tmp_path / "test.db")
    init_db(c)
    yield c
    c.close()


def test_upsert_file_dedupes_by_content(conn):
    fid1, created1 = store.upsert_file(conn, "contract.pdf", b"same bytes")
    fid2, created2 = store.upsert_file(conn, "copy of contract.pdf", b"same bytes")
    assert created1 is True and created2 is False
    assert fid1 == fid2
    assert conn.execute("SELECT count(*) c FROM files").fetchone()["c"] == 1
    row = conn.execute("SELECT * FROM files WHERE id=?", (fid1,)).fetchone()
    assert row["file_type"] == "pdf"
    assert row["size_bytes"] == len(b"same bytes")
    assert row["status"] == "pending"


def test_add_location_multiple_folders_one_file(conn):
    fid, _ = store.upsert_file(conn, "a.txt", b"x")
    store.add_location(conn, fid, "/cases/smith", "evidence", "a.txt")
    store.add_location(conn, fid, "/cases/jones", "", "a.txt")
    store.add_location(conn, fid, "/cases/smith", "evidence", "a.txt")  # idempotent
    rows = conn.execute("SELECT * FROM file_locations WHERE file_id=?", (fid,)).fetchall()
    assert len(rows) == 2


def test_add_location_replaces_stale_mapping(conn):
    old, _ = store.upsert_file(conn, "a.txt", b"v1")
    new, _ = store.upsert_file(conn, "a.txt", b"v2")
    store.add_location(conn, old, "/r", "sub", "a.txt")
    store.add_location(conn, new, "/r", "sub", "a.txt")
    rows = conn.execute(
        "SELECT file_id FROM file_locations WHERE root_folder='/r' AND subfolder_path='sub'"
        " AND filename='a.txt'").fetchall()
    assert [r["file_id"] for r in rows] == [new]


def test_save_markdown_sets_converted_and_is_upsert(conn):
    fid, _ = store.upsert_file(conn, "a.txt", b"hello")
    store.save_markdown(conn, fid, "hello world", "text")
    store.save_markdown(conn, fid, "hello world again", "text")
    md = conn.execute("SELECT * FROM markdown_files WHERE file_id=?", (fid,)).fetchone()
    assert md["content_md"] == "hello world again"
    assert md["word_count"] == 3
    f = conn.execute("SELECT status FROM files WHERE id=?", (fid,)).fetchone()
    assert f["status"] == "converted"
    assert conn.execute("SELECT count(*) c FROM markdown_files").fetchone()["c"] == 1


def test_set_status_failed_with_error(conn):
    fid, _ = store.upsert_file(conn, "a.pdf", b"x")
    store.set_status(conn, fid, "failed", "boom")
    row = conn.execute("SELECT status, error_message FROM files WHERE id=?", (fid,)).fetchone()
    assert row["status"] == "failed" and row["error_message"] == "boom"
