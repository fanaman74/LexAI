import time

import pytest

from app import ingest
from app.db import get_conn, init_db


@pytest.fixture
def case_folder(tmp_path):
    root = tmp_path / "cases"
    (root / "smith" / "evidence").mkdir(parents=True)
    (root / "jones").mkdir(parents=True)
    (root / "smith" / "evidence" / "a.txt").write_text("exhibit A content")
    (root / "smith" / "b.txt").write_text("memo B content")
    (root / "jones" / "a-copy.txt").write_text("exhibit A content")  # duplicate bytes
    (root / "jones" / "photo.jpg").write_bytes(b"\xff\xd8notadoc")   # unsupported
    (root / ".DS_Store").write_bytes(b"junk")                        # hidden
    return root


def test_scan_folder_finds_supported_and_skipped(case_folder):
    supported, skipped = ingest.scan_folder(case_folder)
    names = sorted(p.name for p in supported)
    assert names == ["a-copy.txt", "a.txt", "b.txt"]
    assert skipped == ["jones/photo.jpg"]


def _wait(job_id, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        progress = ingest.JOBS[job_id].snapshot()
        if progress["status"] == "done":
            return progress
        time.sleep(0.05)
    raise AssertionError("ingest did not finish")


def test_ingest_end_to_end(case_folder, tmp_path):
    db_path = str(tmp_path / "ing.db")
    job_id = ingest.start_scan(str(case_folder), db_path)
    progress = _wait(job_id)
    assert progress["total"] == 3
    assert progress["done"] == 3
    assert progress["failed"] == 0
    assert progress["skipped"] == ["jones/photo.jpg"]

    conn = get_conn(db_path)
    # duplicate content -> 2 unique files, 3 locations
    assert conn.execute("SELECT count(*) c FROM files").fetchone()["c"] == 2
    assert conn.execute("SELECT count(*) c FROM file_locations").fetchone()["c"] == 3
    assert conn.execute(
        "SELECT count(*) c FROM files WHERE status='converted'").fetchone()["c"] == 2
    sub = conn.execute(
        "SELECT subfolder_path FROM file_locations WHERE filename='a.txt'").fetchone()
    assert sub["subfolder_path"] == "smith/evidence"
    conn.close()


def test_rescan_is_idempotent(case_folder, tmp_path):
    db_path = str(tmp_path / "ing.db")
    _wait(ingest.start_scan(str(case_folder), db_path))
    _wait(ingest.start_scan(str(case_folder), db_path))
    conn = get_conn(db_path)
    assert conn.execute("SELECT count(*) c FROM files").fetchone()["c"] == 2
    assert conn.execute("SELECT count(*) c FROM file_locations").fetchone()["c"] == 3
    conn.close()


def test_failed_file_does_not_stop_scan(case_folder, tmp_path, monkeypatch):
    from app import convert

    real = convert.convert_to_markdown

    def flaky(filename, content):
        if filename == "b.txt":
            raise convert.ConversionError("boom")
        return real(filename, content)

    monkeypatch.setattr(ingest.convert, "convert_to_markdown", flaky)
    db_path = str(tmp_path / "ing.db")
    progress = _wait(ingest.start_scan(str(case_folder), db_path))
    assert progress["failed"] == 1
    conn = get_conn(db_path)
    row = conn.execute("SELECT status, error_message FROM files"
                       " WHERE original_name='b.txt'").fetchone()
    assert row["status"] == "failed" and "boom" in row["error_message"]
    conn.close()
