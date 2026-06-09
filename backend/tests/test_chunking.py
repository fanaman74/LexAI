from app import store
from app.chunking import CHUNK_SIZE, OVERLAP, chunk_markdown
from app.db import get_conn, init_db


def test_short_text_single_chunk():
    assert chunk_markdown("a short memo") == ["a short memo"]


def test_empty_text_no_chunks():
    assert chunk_markdown("") == []
    assert chunk_markdown("   \n\n  ") == []


def test_long_text_chunks_with_overlap():
    paras = [f"Paragraph {i}. " + ("clause text " * 40) for i in range(20)]
    md = "\n\n".join(paras)
    chunks = chunk_markdown(md)
    assert len(chunks) > 1
    assert all(len(c) <= CHUNK_SIZE + OVERLAP for c in chunks)
    # consecutive chunks share overlapping text
    assert chunks[0][-50:] in chunks[1] or chunks[1][:50] in chunks[0]
    # nothing lost: every paragraph marker appears somewhere
    joined = " ".join(chunks)
    for i in range(20):
        assert f"Paragraph {i}." in joined


def test_giant_paragraph_is_split():
    md = "word " * 2000  # one huge paragraph, no breaks
    chunks = chunk_markdown(md)
    assert len(chunks) > 1
    assert all(len(c) <= CHUNK_SIZE + OVERLAP for c in chunks)


def test_save_markdown_writes_chunks(tmp_path):
    conn = get_conn(tmp_path / "t.db")
    init_db(conn)
    fid, _ = store.upsert_file(conn, "a.txt", b"x")
    store.save_markdown(conn, fid, "hello legal world", "text")
    rows = conn.execute("SELECT * FROM chunks WHERE file_id=?", (fid,)).fetchall()
    assert len(rows) == 1 and rows[0]["text"] == "hello legal world"
    assert rows[0]["embedding"] is None
    # re-conversion replaces chunks rather than appending
    store.save_markdown(conn, fid, "new content entirely", "text")
    rows = conn.execute("SELECT * FROM chunks WHERE file_id=?", (fid,)).fetchall()
    assert len(rows) == 1 and rows[0]["text"] == "new content entirely"
    conn.close()
