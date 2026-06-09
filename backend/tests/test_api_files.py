import time


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_scan_endpoint_and_progress(client, tmp_path):
    root = tmp_path / "docs"
    root.mkdir()
    (root / "x.txt").write_text("hello court")
    res = client.post("/api/scan", json={"path": str(root)})
    assert res.status_code == 200
    job_id = res.json()["job_id"]

    deadline = time.time() + 15
    progress = None
    while time.time() < deadline:
        progress = client.get(f"/api/scan/{job_id}").json()
        if progress["status"] == "done":
            break
        time.sleep(0.05)
    assert progress["status"] == "done"
    assert progress["total"] == 1 and progress["converted"] == 1


def test_scan_rejects_bad_path(client):
    res = client.post("/api/scan", json={"path": "/nonexistent/nope"})
    assert res.status_code == 400


def test_scan_unknown_job_404(client):
    assert client.get("/api/scan/deadbeef").status_code == 404


from app import store
from app.db import get_conn


def _seed(client):
    """Two files: contract in /cases/smith/contracts, memo in /cases/jones."""
    conn = get_conn(client.app.state.db_path)
    fid1, _ = store.upsert_file(conn, "contract.txt", b"indemnification clause text")
    store.add_location(conn, fid1, "/cases", "smith/contracts", "contract.txt")
    store.save_markdown(conn, fid1, "indemnification clause text", "text")
    fid2, _ = store.upsert_file(conn, "memo.txt", b"strategy memo text")
    store.add_location(conn, fid2, "/cases", "jones", "memo.txt")
    store.save_markdown(conn, fid2, "strategy memo text", "text")
    conn.execute("INSERT INTO tags (name) VALUES ('evidence')")
    tag_id = conn.execute("SELECT id FROM tags").fetchone()["id"]
    conn.execute("INSERT INTO file_tags VALUES (?,?)", (fid1, tag_id))
    conn.commit()
    conn.close()
    return fid1, fid2


def test_list_files_no_filter(client):
    fid1, fid2 = _seed(client)
    res = client.get("/api/files")
    assert res.status_code == 200
    files = res.json()["files"]
    assert {f["id"] for f in files} == {fid1, fid2}
    contract = next(f for f in files if f["id"] == fid1)
    assert contract["tags"] == ["evidence"]
    assert contract["locations"][0]["subfolder_path"] == "smith/contracts"


def test_filter_by_folder_prefix(client):
    fid1, _ = _seed(client)
    res = client.get("/api/files", params={"folder": "/cases/smith"})
    files = res.json()["files"]
    assert [f["id"] for f in files] == [fid1]


def test_filter_by_tag_and_fts_query(client):
    fid1, _ = _seed(client)
    assert [f["id"] for f in client.get(
        "/api/files", params={"tag": "evidence"}).json()["files"]] == [fid1]
    assert [f["id"] for f in client.get(
        "/api/files", params={"q": "indemnification"}).json()["files"]] == [fid1]


def test_folder_tree(client):
    _seed(client)
    res = client.get("/api/folders")
    folders = res.json()["folders"]
    paths = {(f["root_folder"], f["subfolder_path"]): f["count"] for f in folders}
    assert paths[("/cases", "smith/contracts")] == 1
    assert paths[("/cases", "jones")] == 1


def test_detail_and_download(client):
    fid1, _ = _seed(client)
    detail = client.get(f"/api/files/{fid1}").json()
    assert detail["original_name"] == "contract.txt"
    assert detail["markdown"]["content_md"] == "indemnification clause text"
    assert detail["tags"] == ["evidence"] and detail["notes"] == []

    dl = client.get(f"/api/files/{fid1}/original")
    assert dl.status_code == 200
    assert dl.content == b"indemnification clause text"
    assert "contract.txt" in dl.headers["content-disposition"]

    assert client.get("/api/files/99999").status_code == 404


def test_retry_reconverts_failed_file(client):
    conn = get_conn(client.app.state.db_path)
    fid, _ = store.upsert_file(conn, "bad.txt", b"now fine")
    store.set_status(conn, fid, "failed", "old error")
    conn.close()
    res = client.post(f"/api/files/{fid}/retry")
    assert res.status_code == 200
    assert res.json()["status"] == "converted"
