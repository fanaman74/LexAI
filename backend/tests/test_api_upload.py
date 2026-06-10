import time


def test_upload_single_txt_file(client):
    content = b"contract text about indemnification"
    res = client.post(
        "/api/upload",
        files=[("files", ("contract.txt", content, "text/plain"))],
    )
    assert res.status_code == 200
    job_id = res.json()["job_id"]
    assert isinstance(job_id, str) and len(job_id) > 0

    deadline = time.time() + 15
    progress = None
    while time.time() < deadline:
        progress = client.get(f"/api/scan/{job_id}").json()
        if progress["status"] == "done":
            break
        time.sleep(0.05)
    assert progress["status"] == "done"
    assert progress["converted"] == 1

    files = client.get("/api/files").json()["files"]
    assert any(f["original_name"] == "contract.txt" for f in files)


def test_upload_multiple_files(client):
    res = client.post(
        "/api/upload",
        files=[
            ("files", ("a.txt", b"text one", "text/plain")),
            ("files", ("b.txt", b"text two", "text/plain")),
        ],
    )
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
    assert progress["converted"] == 2


def test_upload_preserves_original_filename(client):
    res = client.post(
        "/api/upload",
        files=[("files", ("evidence_report.txt", b"evidence text", "text/plain"))],
    )
    assert res.status_code == 200
    job_id = res.json()["job_id"]
    deadline = time.time() + 15
    while time.time() < deadline:
        if client.get(f"/api/scan/{job_id}").json()["status"] == "done":
            break
        time.sleep(0.05)
    files = client.get("/api/files").json()["files"]
    assert any(f["original_name"] == "evidence_report.txt" for f in files)
