import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import ai
from ..deps import get_db

router = APIRouter(prefix="/api")

TITLE_CHARS = 40


class ChatCreate(BaseModel):
    file_ids: list[int]
    message: str


class ChatMessage(BaseModel):
    message: str


def _messages_of(db, chat_id: int) -> list[dict]:
    return [dict(r) for r in db.execute(
        "SELECT id, role, content, created_at FROM chat_messages"
        " WHERE chat_id=%s ORDER BY id", (chat_id,)).fetchall()]


def _converse(db, chat_id: int, file_ids: list[int], user_message: str) -> list[dict]:
    """Append the user message, call the model with docs + history, store reply."""
    context = ai.build_doc_context(db, file_ids)
    history = [{"role": m["role"], "content": m["content"]}
               for m in _messages_of(db, chat_id)]
    db.execute("INSERT INTO chat_messages (chat_id, role, content) VALUES (%s,%s,%s)",
               (chat_id, "user", user_message))
    reply = ai.chat_completion(
        [{"role": "system",
          "content": ai.SYSTEM_PROMPT + "\n\nDocuments:\n\n" + context},
         *history,
         {"role": "user", "content": user_message}])
    db.execute("INSERT INTO chat_messages (chat_id, role, content) VALUES (%s,%s,%s)",
               (chat_id, "assistant", reply))
    return _messages_of(db, chat_id)


@router.post("/chats")
def create_chat(body: ChatCreate, db=Depends(get_db)):
    message = body.message.strip()
    if not body.file_ids or not message:
        raise HTTPException(400, "file_ids and message are required")
    try:
        ai.build_doc_context(db, body.file_ids)  # validate before creating the row
        # document_ids is JSONB — pass Python list directly
        cur = db.execute(
            "INSERT INTO chats (document_ids, title) VALUES (%s,%s) RETURNING id",
            (body.file_ids, message[:TITLE_CHARS]))
        chat_id = cur.fetchone()["id"]
        messages = _converse(db, chat_id, body.file_ids, message)
    except ai.AnalysisError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"OpenRouter error: {exc}")
    return {"id": chat_id, "title": message[:TITLE_CHARS],
            "file_ids": body.file_ids, "messages": messages}


@router.post("/chats/{chat_id}/messages")
def continue_chat(chat_id: int, body: ChatMessage, db=Depends(get_db)):
    row = db.execute(
        "SELECT document_ids FROM chats WHERE id=%s", (chat_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "chat not found")
    message = body.message.strip()
    if not message:
        raise HTTPException(400, "empty message")
    try:
        # document_ids is JSONB — already a Python list from psycopg3
        file_ids = row["document_ids"]
        messages = _converse(db, chat_id, file_ids, message)
    except ai.AnalysisError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"OpenRouter error: {exc}")
    return {"messages": messages}


@router.get("/chats")
def list_chats(db=Depends(get_db)):
    rows = db.execute(
        "SELECT id, document_ids, title, created_at FROM chats"
        " ORDER BY created_at DESC, id DESC LIMIT 100").fetchall()
    chats = []
    for r in rows:
        d = dict(r)
        # document_ids is JSONB — already a Python list
        d["file_ids"] = d.pop("document_ids") or []
        chats.append(d)
    return {"chats": chats}


@router.get("/chats/{chat_id}")
def chat_detail(chat_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, document_ids, title, created_at FROM chats WHERE id=%s",
        (chat_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "chat not found")
    detail = dict(row)
    detail["file_ids"] = detail.pop("document_ids") or []
    detail["messages"] = _messages_of(db, chat_id)
    return detail
