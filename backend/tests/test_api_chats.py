import pytest

from app import ai, store
from app.db import get_conn


@pytest.fixture
def seeded(client):
    conn = get_conn(client.app.state.db_path)
    fid, _ = store.upsert_file(conn, "contract.txt", b"x")
    store.save_markdown(conn, fid, "Term: 24 months. Notice: 90 days.", "text")
    conn.close()
    return fid


@pytest.fixture
def fake_chat(monkeypatch):
    sent = {}

    class FakeResponse:
        def raise_for_status(self):
            pass
        def json(self):
            return {"choices": [{"message": {"content": "Notice period is 90 days."}}]}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent["json"] = json
        return FakeResponse()

    monkeypatch.setattr(ai.httpx, "post", fake_post)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    return sent


def test_create_chat_and_continue(client, seeded, fake_chat):
    res = client.post("/api/chats", json={
        "file_ids": [seeded], "message": "What is the notice period?"})
    assert res.status_code == 200
    chat = res.json()
    chat_id = chat["id"]
    assert chat["title"].startswith("What is the notice")
    assert chat["messages"][-1]["role"] == "assistant"
    assert "90 days" in chat["messages"][-1]["content"]
    # document content went along
    sent_user = [m for m in fake_chat["json"]["messages"] if m["role"] == "user"]
    assert "24 months" in fake_chat["json"]["messages"][0]["content"] or \
           any("24 months" in m["content"] for m in sent_user)

    res2 = client.post(f"/api/chats/{chat_id}/messages",
                       json={"message": "And the term?"})
    assert res2.status_code == 200
    msgs = res2.json()["messages"]
    assert len(msgs) == 4  # u, a, u, a
    # history included in second call
    roles = [m["role"] for m in fake_chat["json"]["messages"]]
    assert roles.count("user") >= 2

    listing = client.get("/api/chats").json()["chats"]
    assert len(listing) == 1 and listing[0]["id"] == chat_id

    detail = client.get(f"/api/chats/{chat_id}").json()
    assert detail["file_ids"] == [seeded]
    assert len(detail["messages"]) == 4


def test_chat_unknown_file_400(client, fake_chat):
    res = client.post("/api/chats", json={"file_ids": [999], "message": "hi"})
    assert res.status_code == 400


def test_chat_unknown_chat_404(client, fake_chat):
    assert client.post("/api/chats/777/messages",
                       json={"message": "hi"}).status_code == 404
