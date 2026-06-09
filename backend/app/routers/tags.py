import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..deps import get_db

router = APIRouter(prefix="/api")


class TagBody(BaseModel):
    name: str


class NoteBody(BaseModel):
    content: str


def _file_exists(db, file_id: int):
    if db.execute("SELECT 1 FROM files WHERE id=?", (file_id,)).fetchone() is None:
        raise HTTPException(404, "file not found")


@router.get("/tags")
def list_tags(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT t.name, COUNT(ft.file_id) AS count FROM tags t"
        " LEFT JOIN file_tags ft ON ft.tag_id = t.id"
        " GROUP BY t.id ORDER BY t.name").fetchall()
    return {"tags": [dict(r) for r in rows]}


@router.post("/files/{file_id}/tags")
def add_tag(file_id: int, body: TagBody, db: sqlite3.Connection = Depends(get_db)):
    name = body.name.strip().lower()
    if not name:
        raise HTTPException(400, "empty tag name")
    _file_exists(db, file_id)
    db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
    tag_id = db.execute("SELECT id FROM tags WHERE name=?", (name,)).fetchone()["id"]
    db.execute("INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?,?)",
               (file_id, tag_id))
    db.commit()
    return {"ok": True}


@router.delete("/files/{file_id}/tags/{name}")
def remove_tag(file_id: int, name: str, db: sqlite3.Connection = Depends(get_db)):
    db.execute(
        "DELETE FROM file_tags WHERE file_id=? AND tag_id ="
        " (SELECT id FROM tags WHERE name=?)", (file_id, name.strip().lower()))
    db.commit()
    return {"ok": True}


@router.post("/files/{file_id}/notes")
def add_note(file_id: int, body: NoteBody, db: sqlite3.Connection = Depends(get_db)):
    if not body.content.strip():
        raise HTTPException(400, "empty note")
    _file_exists(db, file_id)
    cur = db.execute("INSERT INTO notes (file_id, content) VALUES (?,?)",
                     (file_id, body.content.strip()))
    db.commit()
    return {"id": cur.lastrowid}


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM notes WHERE id=?", (note_id,))
    db.commit()
    return {"ok": True}
