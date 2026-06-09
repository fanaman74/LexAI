import pytest

from app import embeddings, vectors
from app.db import get_conn, init_db


@pytest.fixture
def conn(tmp_path):
    c = get_conn(tmp_path / "v.db")
    init_db(c)
    yield c
    c.close()


def _seed_chunks(conn, n=3):
    conn.execute(
        "INSERT INTO files (sha256, original_name, file_type, size_bytes, content)"
        " VALUES ('hv', 'a.txt', 'txt', 1, X'61')")
    fid = conn.execute("SELECT id FROM files").fetchone()["id"]
    ids = []
    for i in range(n):
        cur = conn.execute(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?,?,?)",
            (fid, i, f"chunk {i}"))
        ids.append(cur.lastrowid)
    conn.commit()
    return fid, ids


def test_store_and_search_roundtrip(conn):
    _, ids = _seed_chunks(conn)
    vecs = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.9, 0.1, 0.0]]
    for cid, v in zip(ids, vecs):
        vectors.upsert(conn, cid, v)
    results = vectors.search(conn, [1.0, 0.0, 0.0], k=2)
    assert [r[0] for r in results] == [ids[0], ids[2]]
    assert results[0][1] > results[1][1] > 0.5  # similarity scores, descending


def test_search_skips_unembedded_chunks(conn):
    _, ids = _seed_chunks(conn)
    vectors.upsert(conn, ids[0], [1.0, 0.0, 0.0])
    results = vectors.search(conn, [1.0, 0.0, 0.0], k=10)
    assert [r[0] for r in results] == [ids[0]]


def test_search_empty_index(conn):
    assert vectors.search(conn, [1.0, 0.0, 0.0], k=5) == []


def test_numpy_fallback_when_extension_unavailable(conn, monkeypatch):
    _, ids = _seed_chunks(conn)
    monkeypatch.setattr(vectors, "_try_load_vec", lambda c: False)
    vectors.upsert(conn, ids[0], [1.0, 0.0, 0.0])
    vectors.upsert(conn, ids[1], [0.0, 1.0, 0.0])
    results = vectors.search(conn, [0.9, 0.1, 0.0], k=1)
    assert results[0][0] == ids[0] and results[0][1] > 0.9


def test_embed_texts_batches_and_parses(monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            pass
        def json(self):
            return {"data": [{"index": i, "embedding": [float(i), 1.0]}
                             for i in range(len(calls[-1]["input"]))]}

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(json)
        return FakeResponse()

    monkeypatch.setattr(embeddings.httpx, "post", fake_post)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    texts = [f"t{i}" for i in range(100)]  # > one batch of 96
    out = embeddings.embed_texts(texts)
    assert len(out) == 100 and len(calls) == 2
    assert calls[0]["model"] == embeddings.EMBEDDING_MODEL


def test_embed_texts_requires_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(embeddings.EmbeddingError, match="OPENROUTER_API_KEY"):
        embeddings.embed_texts(["x"])
