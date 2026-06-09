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
