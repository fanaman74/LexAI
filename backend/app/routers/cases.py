from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..deps import get_db

router = APIRouter(prefix="/api")


class CreateCase(BaseModel):
    name: str
    description: str = ""


class AddFiles(BaseModel):
    file_ids: list[int]


def _case_with_files(db, case_id: int) -> dict | None:
    row = db.execute(
        "SELECT id, name, description, created_at FROM cases WHERE id=%s",
        (case_id,)).fetchone()
    if row is None:
        return None
    files = db.execute(
        """SELECT d.id, d.original_filename, d.processing_status, d.summary
           FROM case_documents cd JOIN documents d ON d.id=cd.document_id
           WHERE cd.case_id=%s ORDER BY cd.added_at DESC""",
        (case_id,)).fetchall()
    return {**dict(row), "file_count": len(files),
            "files": [dict(f) for f in files]}


@router.get("/cases")
def list_cases(db=Depends(get_db)):
    rows = db.execute(
        "SELECT id FROM cases ORDER BY created_at DESC").fetchall()
    return {"cases": [c for r in rows
                      if (c := _case_with_files(db, r["id"])) is not None]}


@router.post("/cases")
def create_case(body: CreateCase, db=Depends(get_db)):
    cur = db.execute(
        "INSERT INTO cases (name, description) VALUES (%s, %s) RETURNING id",
        (body.name.strip(), body.description.strip()))
    row = cur.fetchone()
    new_id = row["id"]
    detail = db.execute(
        "SELECT id, name, description, created_at FROM cases WHERE id=%s",
        (new_id,)).fetchone()
    return {**dict(detail), "file_count": 0, "files": []}


@router.get("/cases/{case_id}")
def get_case(case_id: int, db=Depends(get_db)):
    case = _case_with_files(db, case_id)
    if case is None:
        raise HTTPException(404, "case not found")
    return case


@router.post("/cases/{case_id}/files")
def add_files_to_case(case_id: int, body: AddFiles, db=Depends(get_db)):
    if db.execute("SELECT 1 FROM cases WHERE id=%s", (case_id,)).fetchone() is None:
        raise HTTPException(404, "case not found")
    for fid in body.file_ids:
        db.execute(
            "INSERT INTO case_documents (case_id, document_id)"
            " VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (case_id, fid))
    return {"ok": True}


@router.delete("/cases/{case_id}/files/{file_id}")
def remove_file_from_case(case_id: int, file_id: int, db=Depends(get_db)):
    db.execute(
        "DELETE FROM case_documents WHERE case_id=%s AND document_id=%s",
        (case_id, file_id))
    return {"ok": True}


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, db=Depends(get_db)):
    if db.execute("SELECT 1 FROM cases WHERE id=%s", (case_id,)).fetchone() is None:
        raise HTTPException(404, "case not found")
    db.execute("DELETE FROM cases WHERE id=%s", (case_id,))
    return {"ok": True}
