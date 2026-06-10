import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..deps import get_db

router = APIRouter(prefix="/api")


class CreateCase(BaseModel):
    name: str
    description: str = ""


class AddFiles(BaseModel):
    file_ids: list[int]


def _case_with_files(conn: sqlite3.Connection, case_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, name, description, created_at FROM cases WHERE id=?",
        (case_id,)).fetchone()
    if row is None:
        return None
    files = conn.execute(
        """SELECT f.id, f.original_name, f.status,
           EXISTS(SELECT 1 FROM markdown_files m WHERE m.file_id=f.id) AS has_markdown
           FROM case_files cf JOIN files f ON f.id=cf.file_id
           WHERE cf.case_id=? ORDER BY cf.added_at DESC""",
        (case_id,)).fetchall()
    return {**dict(row), "file_count": len(files),
            "files": [dict(f) for f in files]}


@router.get("/cases")
def list_cases(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT id FROM cases ORDER BY created_at DESC").fetchall()
    return {"cases": [c for r in rows
                      if (c := _case_with_files(db, r["id"])) is not None]}


@router.post("/cases")
def create_case(body: CreateCase, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO cases (name, description) VALUES (?, ?)",
        (body.name.strip(), body.description.strip()))
    db.commit()
    row = db.execute(
        "SELECT id, name, description, created_at FROM cases WHERE id=?",
        (cur.lastrowid,)).fetchone()
    return {**dict(row), "file_count": 0, "files": []}


@router.get("/cases/{case_id}")
def get_case(case_id: int, db: sqlite3.Connection = Depends(get_db)):
    case = _case_with_files(db, case_id)
    if case is None:
        raise HTTPException(404, "case not found")
    return case


@router.post("/cases/{case_id}/files")
def add_files_to_case(case_id: int, body: AddFiles,
                      db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM cases WHERE id=?", (case_id,)).fetchone() is None:
        raise HTTPException(404, "case not found")
    for fid in body.file_ids:
        db.execute(
            "INSERT OR IGNORE INTO case_files (case_id, file_id) VALUES (?, ?)",
            (case_id, fid))
    db.commit()
    return {"ok": True}


@router.delete("/cases/{case_id}/files/{file_id}")
def remove_file_from_case(case_id: int, file_id: int,
                           db: sqlite3.Connection = Depends(get_db)):
    db.execute(
        "DELETE FROM case_files WHERE case_id=? AND file_id=?",
        (case_id, file_id))
    db.commit()
    return {"ok": True}


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM cases WHERE id=?", (case_id,)).fetchone() is None:
        raise HTTPException(404, "case not found")
    db.execute("DELETE FROM cases WHERE id=?", (case_id,))
    db.commit()
    return {"ok": True}
