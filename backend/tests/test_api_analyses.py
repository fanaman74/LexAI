import pytest

from app import ai, store
from app.db import get_conn


@pytest.fixture
def seeded(client):
    conn = get_conn(client.app.state.db_path)
    fid, _ = store.upsert_file(conn, "contract.txt", b"x")
    store.save_markdown(conn, fid, "Term: 24 months. Penalty: 5% monthly.", "text")
    conn.close()
    return fid


@pytest.fixture
def fake_openrouter(monkeypatch):
    calls = {}

    class FakeResponse:
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {"choices": [{"message": {"content": "The term is 24 months."}}]}

    def fake_post(url, headers=None, json=None, timeout=None):
        calls["url"] = url
        calls["json"] = json
        calls["headers"] = headers
        return FakeResponse()

    monkeypatch.setattr(ai.httpx, "post", fake_post)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    return calls


def test_analysis_calls_openrouter_and_persists(client, seeded, fake_openrouter):
    res = client.post("/api/analyses",
                      json={"file_ids": [seeded], "prompt": "What is the term?"})
    assert res.status_code == 200
    body = res.json()
    assert body["response"] == "The term is 24 months."
    assert fake_openrouter["json"]["model"] == ai.MODEL
    sent = fake_openrouter["json"]["messages"][-1]["content"]
    assert "24 months" in sent and "What is the term?" in sent
    assert fake_openrouter["headers"]["Authorization"] == "Bearer sk-test"

    history = client.get("/api/analyses").json()["analyses"]
    assert len(history) == 1
    assert history[0]["file_ids"] == [seeded]


def test_analysis_missing_key_returns_error(client, seeded, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    res = client.post("/api/analyses",
                      json={"file_ids": [seeded], "prompt": "?"})
    assert res.status_code == 400
    assert "OPENROUTER_API_KEY" in res.json()["detail"]


def test_analysis_unconverted_file_400(client, fake_openrouter):
    conn = get_conn(client.app.state.db_path)
    fid, _ = store.upsert_file(conn, "raw.pdf", b"y")
    conn.close()
    res = client.post("/api/analyses", json={"file_ids": [fid], "prompt": "?"})
    assert res.status_code == 400
