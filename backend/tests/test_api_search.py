from app import store
from app.db import get_conn


def test_search_returns_snippets(client):
    conn = get_conn(client.app.state.db_path)
    fid, _ = store.upsert_file(conn, "lease.txt", b"x")
    store.add_location(conn, fid, "/cases", "smith", "lease.txt")
    store.save_markdown(
        conn, fid,
        "The tenant shall pay rent monthly. Late payment incurs a penalty of 5%.",
        "text")
    conn.close()

    res = client.get("/api/search", params={"q": "penalty"})
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 1
    assert results[0]["file_id"] == fid
    assert results[0]["original_name"] == "lease.txt"
    assert "<mark>penalty</mark>" in results[0]["snippet"]


def test_search_empty_query_400(client):
    assert client.get("/api/search", params={"q": ""}).status_code == 400


def test_search_bad_fts_syntax_returns_empty(client):
    res = client.get("/api/search", params={"q": '"unbalanced'})
    assert res.status_code == 200
    assert res.json()["results"] == []
