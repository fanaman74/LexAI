import io
import time


def test_create_and_list_cases(client):
    r = client.post("/api/cases", json={"name": "Smith v. Jones"})
    assert r.status_code == 200
    case = r.json()
    assert case["name"] == "Smith v. Jones"
    assert case["id"] > 0

    r2 = client.get("/api/cases")
    assert r2.status_code == 200
    cases = r2.json()["cases"]
    assert len(cases) == 1
    assert cases[0]["file_count"] == 0


def test_delete_case(client):
    r = client.post("/api/cases", json={"name": "To Delete"})
    case_id = r.json()["id"]
    r2 = client.delete(f"/api/cases/{case_id}")
    assert r2.status_code == 200
    assert r2.json()["ok"] is True
    assert client.get("/api/cases").json()["cases"] == []


def test_add_and_remove_file_from_case(client):
    case_id = client.post("/api/cases", json={"name": "Test Case"}).json()["id"]
    f = io.BytesIO(b"hello world")
    r = client.post("/api/upload", files={"files": ("test.txt", f, "text/plain")})
    assert r.status_code == 200

    job_id = r.json()["job_id"]
    for _ in range(20):
        prog = client.get(f"/api/scan/{job_id}").json()
        if prog["status"] == "done":
            break
        time.sleep(0.5)

    files = client.get("/api/files").json()["files"]
    assert len(files) >= 1
    file_id = files[0]["id"]

    r2 = client.post(f"/api/cases/{case_id}/files", json={"file_ids": [file_id]})
    assert r2.status_code == 200

    detail = client.get(f"/api/cases/{case_id}").json()
    assert any(f["id"] == file_id for f in detail["files"])

    r3 = client.delete(f"/api/cases/{case_id}/files/{file_id}")
    assert r3.status_code == 200
    detail2 = client.get(f"/api/cases/{case_id}").json()
    assert not any(f["id"] == file_id for f in detail2["files"])


def test_upload_with_case_id_links_files(client):
    case_id = client.post("/api/cases", json={"name": "Auto Link"}).json()["id"]
    import io, time
    f = io.BytesIO(b"contract text")
    r = client.post("/api/upload",
        data={"case_id": case_id},
        files={"files": ("contract.txt", f, "text/plain")})
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    for _ in range(20):
        prog = client.get(f"/api/scan/{job_id}").json()
        if prog["status"] == "done":
            break
        time.sleep(0.5)
    detail = client.get(f"/api/cases/{case_id}").json()
    assert detail["file_count"] >= 1
