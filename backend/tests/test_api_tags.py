import pytest

from app import store
from app.db import get_conn


@pytest.fixture
def file_id(client):
    conn = get_conn(client.app.state.db_path)
    fid, _ = store.upsert_file(conn, "doc.txt", b"content")
    conn.close()
    return fid


def test_tag_lifecycle(client, file_id):
    res = client.post(f"/api/files/{file_id}/tags", json={"name": "Evidence"})
    assert res.status_code == 200
    # normalized to lowercase, idempotent
    client.post(f"/api/files/{file_id}/tags", json={"name": "evidence"})
    assert client.get("/api/tags").json()["tags"] == [{"name": "evidence", "count": 1}]

    detail = client.get(f"/api/files/{file_id}").json()
    assert detail["tags"] == ["evidence"]

    assert client.delete(f"/api/files/{file_id}/tags/evidence").status_code == 200
    assert client.get(f"/api/files/{file_id}").json()["tags"] == []


def test_tag_blank_name_400(client, file_id):
    assert client.post(f"/api/files/{file_id}/tags", json={"name": "  "}).status_code == 400


def test_notes_lifecycle(client, file_id):
    res = client.post(f"/api/files/{file_id}/notes",
                      json={"content": "Check clause 4.2 against the 2025 amendment."})
    assert res.status_code == 200
    note_id = res.json()["id"]
    notes = client.get(f"/api/files/{file_id}").json()["notes"]
    assert len(notes) == 1 and "clause 4.2" in notes[0]["content"]
    assert client.delete(f"/api/notes/{note_id}").status_code == 200
    assert client.get(f"/api/files/{file_id}").json()["notes"] == []
