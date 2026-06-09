import time

import pytest

from app import embeddings, indexer, store
from app.db import get_conn


@pytest.fixture
def fake_embeddings(monkeypatch):
    """Deterministic embeddings: 'lease'-ish texts → x-axis, others → y-axis."""
    def fake_embed(texts):
        return [[1.0, 0.0] if "lease" in t.lower() else [0.0, 1.0] for t in texts]
    monkeypatch.setattr(indexer, "embed_texts", fake_embed)
    monkeypatch.setattr(embeddings, "embed_texts", fake_embed)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    return fake_embed


def _seed(client):
    conn = get_conn(client.app.state.db_path)
    fid1, _ = store.upsert_file(conn, "lease.txt", b"a")
    store.save_markdown(conn, fid1, "The lease for the office premises.", "text")
    fid2, _ = store.upsert_file(conn, "memo.txt", b"b")
    store.save_markdown(conn, fid2, "Internal memo about staffing.", "text")
    conn.close()
    return fid1, fid2


def _wait_index(client, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = client.get("/api/index/status").json()
        if status["status"] in ("done", "idle"):
            return status
        time.sleep(0.05)
    raise AssertionError("indexing did not finish")


def test_index_embeds_pending_chunks(client, fake_embeddings):
    _seed(client)
    res = client.post("/api/index")
    assert res.status_code == 200
    status = _wait_index(client)
    assert status["indexed"] == 2 and status["failed"] == 0

    conn = get_conn(client.app.state.db_path)
    assert conn.execute(
        "SELECT count(*) c FROM chunks WHERE embedding IS NULL").fetchone()["c"] == 0
    conn.close()
    # re-index with nothing pending is a no-op
    client.post("/api/index")
    assert _wait_index(client)["indexed"] == 0


def test_semantic_search_ranks_by_similarity(client, fake_embeddings):
    fid1, fid2 = _seed(client)
    client.post("/api/index")
    _wait_index(client)

    res = client.get("/api/semantic-search", params={"q": "lease agreement"})
    assert res.status_code == 200
    results = res.json()["results"]
    assert results[0]["file_id"] == fid1
    assert results[0]["score"] > 0.9
    assert "lease" in results[0]["snippet"].lower()
    # one entry per file (grouped), best chunk wins
    assert len([r for r in results if r["file_id"] == fid1]) == 1


def test_semantic_search_without_key_400(client, monkeypatch):
    _seed(client)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    res = client.get("/api/semantic-search", params={"q": "lease"})
    assert res.status_code == 400
    assert "OPENROUTER_API_KEY" in res.json()["detail"]


def test_semantic_search_unindexed_400(client, fake_embeddings):
    _seed(client)  # chunks exist but no embeddings yet
    res = client.get("/api/semantic-search", params={"q": "lease"})
    assert res.status_code == 400
    assert "index" in res.json()["detail"].lower()
