import subprocess
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from ..deps import get_db

router = APIRouter(prefix="/api")


def _row_to_doc(row) -> dict:
    d = dict(row)
    # keywords is JSONB — already a Python list from psycopg3
    if d.get("keywords") is None:
        d["keywords"] = []
    return d


@router.get("/files")
def list_files(
    folder: str | None = None,
    file_type: str | None = None,
    status: str | None = None,
    case_id: int | None = None,
    q: str | None = None,
    db=Depends(get_db),
):
    where, params = [], []
    if folder:
        where.append(
            "EXISTS (SELECT 1 FROM document_locations l WHERE l.document_id=d.id"
            " AND (l.root_folder || '/' || l.subfolder_path) LIKE %s || '%%')"
        )
        params.append(folder.rstrip("/"))
    if file_type:
        types = file_type.split(",")
        where.append(f"d.file_type = ANY(%s::text[])")
        params.append(types)
    if status:
        statuses = status.split(",")
        where.append(f"d.processing_status = ANY(%s::text[])")
        params.append(statuses)
    if case_id is not None:
        where.append(
            "EXISTS (SELECT 1 FROM case_documents cd"
            " WHERE cd.document_id=d.id AND cd.case_id=%s)"
        )
        params.append(case_id)
    if q:
        where.append(
            "to_tsvector('english', coalesce(d.extracted_text,'')) @@ plainto_tsquery('english', %s)"
        )
        params.append(q)

    sql = (
        "SELECT d.id, d.original_filename, d.file_type, d.file_size,"
        " d.processing_status, d.processing_error, d.summary, d.keywords, d.created_at"
        " FROM documents d"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY d.created_at DESC, d.id DESC LIMIT 500"
    rows = db.execute(sql, params).fetchall()
    return {"files": [_row_to_doc(r) for r in rows]}


@router.get("/folders")
def folder_tree(db=Depends(get_db)):
    rows = db.execute(
        "SELECT root_folder, subfolder_path, COUNT(DISTINCT document_id) AS count"
        " FROM document_locations GROUP BY root_folder, subfolder_path"
        " ORDER BY root_folder, subfolder_path"
    ).fetchall()
    return {"folders": [dict(r) for r in rows]}


@router.get("/files/summarise-all/status")
def summarise_all_status_get():
    return _summarise_progress


@router.get("/files/{file_id}")
def file_detail(file_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, original_filename, file_type, file_size, file_hash,"
        " processing_status, processing_error, summary, keywords,"
        " extracted_text, created_at, processed_at"
        " FROM documents WHERE id=%s",
        (file_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "file not found")
    detail = _row_to_doc(row)
    detail["locations"] = [
        dict(r)
        for r in db.execute(
            "SELECT root_folder, subfolder_path, filename, scanned_at"
            " FROM document_locations WHERE document_id=%s",
            (file_id,),
        ).fetchall()
    ]
    return detail


INLINE_MIME = {
    "pdf": "application/pdf",
    "txt": "text/plain; charset=utf-8",
    "csv": "text/plain; charset=utf-8",
    "eml": "text/plain; charset=utf-8",
}


@router.get("/files/{file_id}/original")
def download_original(file_id: int, inline: int = 0, db=Depends(get_db)):
    row = db.execute(
        "SELECT original_filename, file_type, storage_path FROM documents WHERE id=%s",
        (file_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "file not found")
    storage_path = row["storage_path"]
    if not storage_path or not Path(storage_path).exists():
        raise HTTPException(404, "original file not available on disk")
    content = Path(storage_path).read_bytes()
    mime = INLINE_MIME.get(row["file_type"]) if inline else None
    disposition = "inline" if inline and mime else "attachment"
    return Response(
        content=content,
        media_type=mime or "application/octet-stream",
        headers={"Content-Disposition": f'{disposition}; filename="{row["original_filename"]}"'},
    )


class RevealBody(BaseModel):
    location_index: int = 0


@router.post("/files/{file_id}/reveal")
def reveal_in_finder(file_id: int, body: RevealBody, db=Depends(get_db)):
    if db.execute("SELECT 1 FROM documents WHERE id=%s", (file_id,)).fetchone() is None:
        raise HTTPException(404, "file not found")
    locations = db.execute(
        "SELECT root_folder, subfolder_path, filename FROM document_locations"
        " WHERE document_id=%s ORDER BY id",
        (file_id,),
    ).fetchall()
    if not locations or body.location_index >= len(locations):
        raise HTTPException(400, "no such location for this file")
    loc = locations[body.location_index]
    path = Path(loc["root_folder"]) / loc["subfolder_path"] / loc["filename"]
    proc = subprocess.run(["open", "-R", str(path)], capture_output=True, timeout=15)
    if proc.returncode != 0:
        return {"ok": False, "error": f"could not reveal {path} (moved or deleted?)"}
    return {"ok": True}


_summarise_progress: dict = {"running": False, "done": 0, "total": 0, "errors": 0}


@router.post("/files/summarise-all")
def summarise_all_files(request: Request, db=Depends(get_db)):
    """Queue background LLM summarisation for all documents missing keywords/summary."""
    if _summarise_progress["running"]:
        return {"status": "already_running", **_summarise_progress}

    rows = db.execute(
        "SELECT id FROM documents"
        " WHERE (keywords IS NULL OR keywords = '[]'::jsonb)"
        " AND extracted_text IS NOT NULL"
        " ORDER BY id"
    ).fetchall()
    doc_ids = [r["id"] for r in rows]
    if not doc_ids:
        return {"status": "nothing_to_do", "total": 0}

    def _run():
        _summarise_progress.update(running=True, done=0, total=len(doc_ids), errors=0)
        from .. import ai
        from ..db import get_conn

        for did in doc_ids:
            conn = get_conn()
            try:
                doc_row = conn.execute(
                    "SELECT extracted_text FROM documents WHERE id=%s", (did,)
                ).fetchone()
                if doc_row and doc_row["extracted_text"]:
                    kws, summary = ai.summarise_document(doc_row["extracted_text"])
                    conn.execute(
                        "UPDATE documents SET keywords=%s, summary=%s WHERE id=%s",
                        (kws, summary, did),
                    )
                    conn.commit()
            except Exception:
                _summarise_progress["errors"] += 1
            finally:
                conn.close()
                _summarise_progress["done"] += 1
        _summarise_progress["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started", "total": len(doc_ids)}


@router.post("/files/{file_id}/summarise")
def summarise_file(file_id: int, db=Depends(get_db)):
    """(Re)generate keywords + summary for a document that has extracted text."""
    from .. import ai

    doc_row = db.execute(
        "SELECT extracted_text FROM documents WHERE id=%s", (file_id,)
    ).fetchone()
    if doc_row is None:
        raise HTTPException(404, "document not found")
    if not doc_row["extracted_text"]:
        raise HTTPException(400, "document has no extracted text")
    try:
        keywords, summary = ai.summarise_document(doc_row["extracted_text"])
        db.execute(
            "UPDATE documents SET keywords=%s, summary=%s WHERE id=%s",
            (keywords, summary, file_id),
        )
        return {"ok": True, "keywords": keywords, "summary": summary}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.delete("/files")
def delete_all_files(db=Depends(get_db)):
    count = db.execute("SELECT count(*) AS c FROM documents").fetchone()["c"]
    db.execute("DELETE FROM documents")
    return {"ok": True, "deleted": count}


@router.delete("/files/{file_id}")
def delete_file(file_id: int, db=Depends(get_db)):
    if db.execute("SELECT 1 FROM documents WHERE id=%s", (file_id,)).fetchone() is None:
        raise HTTPException(404, "file not found")
    db.execute("DELETE FROM documents WHERE id=%s", (file_id,))
    return {"ok": True}


@router.post("/documents/{doc_id}/reprocess")
def reprocess_document(doc_id: int, db=Depends(get_db)):
    """Delete old chunks and re-run the full pipeline for this document."""
    row = db.execute(
        "SELECT id, original_filename, storage_path FROM documents WHERE id=%s",
        (doc_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "document not found")
    storage_path = row["storage_path"]
    if not storage_path or not Path(storage_path).exists():
        raise HTTPException(400, "original file not found on disk — cannot reprocess")
    content = Path(storage_path).read_bytes()
    db.execute("DELETE FROM document_chunks WHERE document_id=%s", (doc_id,))
    db.execute(
        "UPDATE documents SET processing_status='uploaded', processing_error=NULL,"
        " extracted_text=NULL, processed_at=NULL WHERE id=%s",
        (doc_id,),
    )
    from ..pipeline import process_document

    threading.Thread(
        target=process_document,
        args=(doc_id, row["original_filename"], content),
        daemon=True,
    ).start()
    return {"started": True, "document_id": doc_id}
