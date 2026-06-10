import json
import sqlite3
import subprocess
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import convert, store
from ..db import get_conn
from ..deps import get_db

router = APIRouter(prefix="/api")

LIST_COLUMNS = """f.id, f.original_name, f.file_type, f.size_bytes, f.status,
  f.error_message, f.created_at,
  (SELECT json_group_array(json_object('root_folder', l.root_folder,
     'subfolder_path', l.subfolder_path, 'filename', l.filename))
   FROM file_locations l WHERE l.file_id = f.id) AS locations,
  (SELECT json_group_array(t.name) FROM file_tags ft
   JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = f.id) AS tags,
  EXISTS(SELECT 1 FROM markdown_files m WHERE m.file_id = f.id) AS has_markdown,
  (SELECT m.keywords FROM markdown_files m WHERE m.file_id = f.id) AS keywords,
  (SELECT m.summary FROM markdown_files m WHERE m.file_id = f.id) AS summary"""


def _row_to_file(row) -> dict:
    d = dict(row)
    d["locations"] = json.loads(d["locations"])
    d["tags"] = sorted(json.loads(d["tags"]))
    try:
        d["keywords"] = json.loads(d["keywords"]) if d.get("keywords") else []
    except Exception:
        d["keywords"] = []
    return d


@router.get("/files")
def list_files(folder: str | None = None, file_type: str | None = None,
               status: str | None = None, tag: str | None = None,
               case_id: int | None = None,
               q: str | None = None, db: sqlite3.Connection = Depends(get_db)):
    where, params = [], []
    if folder:
        where.append(
            "EXISTS (SELECT 1 FROM file_locations l WHERE l.file_id=f.id AND"
            " (l.root_folder || '/' || l.subfolder_path) LIKE ? || '%')")
        params.append(folder.rstrip("/"))
    if file_type:
        types = file_type.split(",")
        where.append(f"f.file_type IN ({','.join('?' * len(types))})")
        params.extend(types)
    if status:
        statuses = status.split(",")
        where.append(f"f.status IN ({','.join('?' * len(statuses))})")
        params.extend(statuses)
    if tag:
        where.append(
            "EXISTS (SELECT 1 FROM file_tags ft JOIN tags t ON t.id=ft.tag_id"
            " WHERE ft.file_id=f.id AND t.name=?)")
        params.append(tag)
    if case_id is not None:
        where.append("EXISTS (SELECT 1 FROM case_files cf WHERE cf.file_id=f.id AND cf.case_id=?)")
        params.append(case_id)
    if q:
        where.append(
            "f.id IN (SELECT m.file_id FROM markdown_fts"
            " JOIN markdown_files m ON m.id = markdown_fts.rowid"
            " WHERE markdown_fts MATCH ?)")
        params.append(q)
    sql = f"SELECT {LIST_COLUMNS} FROM files f"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY f.created_at DESC, f.id DESC LIMIT 500"
    try:
        rows = db.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        return {"files": []}  # malformed FTS syntax from user input
    return {"files": [_row_to_file(r) for r in rows]}


@router.get("/folders")
def folder_tree(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT root_folder, subfolder_path, COUNT(DISTINCT file_id) AS count"
        " FROM file_locations GROUP BY root_folder, subfolder_path"
        " ORDER BY root_folder, subfolder_path").fetchall()
    return {"folders": [dict(r) for r in rows]}


@router.get("/files/summarise-all/status")
def summarise_all_status_get():
    return _summarise_progress


@router.get("/files/{file_id}")
def file_detail(file_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, sha256, original_name, file_type, size_bytes, status,"
        " error_message, created_at, updated_at FROM files WHERE id=?",
        (file_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "file not found")
    detail = dict(row)
    detail["locations"] = [dict(r) for r in db.execute(
        "SELECT root_folder, subfolder_path, filename, scanned_at"
        " FROM file_locations WHERE file_id=?", (file_id,)).fetchall()]
    md = db.execute(
        "SELECT content_md, converter_used, converted_at, word_count, keywords, summary"
        " FROM markdown_files WHERE file_id=?", (file_id,)).fetchone()
    if md:
        md_dict = dict(md)
        if md_dict.get("keywords"):
            import json as _json
            try:
                md_dict["keywords"] = _json.loads(md_dict["keywords"])
            except Exception:
                md_dict["keywords"] = []
        else:
            md_dict["keywords"] = []
        detail["markdown"] = md_dict
    else:
        detail["markdown"] = None
    detail["tags"] = sorted(r["name"] for r in db.execute(
        "SELECT t.name FROM file_tags ft JOIN tags t ON t.id=ft.tag_id"
        " WHERE ft.file_id=?", (file_id,)).fetchall())
    detail["notes"] = [dict(r) for r in db.execute(
        "SELECT id, content, created_at FROM notes WHERE file_id=?"
        " ORDER BY created_at DESC, id DESC", (file_id,)).fetchall()]
    return detail


INLINE_MIME = {
    "pdf": "application/pdf",
    "txt": "text/plain; charset=utf-8",
    "csv": "text/plain; charset=utf-8",
    "eml": "text/plain; charset=utf-8",
}


@router.get("/files/{file_id}/original")
def download_original(file_id: int, inline: int = 0,
                      db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT original_name, file_type, content FROM files WHERE id=?",
        (file_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "file not found")
    mime = INLINE_MIME.get(row["file_type"]) if inline else None
    disposition = "inline" if inline and mime else "attachment"
    return Response(
        content=row["content"],
        media_type=mime or "application/octet-stream",
        headers={"Content-Disposition":
                 f'{disposition}; filename="{row["original_name"]}"'})


class RevealBody(BaseModel):
    location_index: int = 0


@router.post("/files/{file_id}/reveal")
def reveal_in_finder(file_id: int, body: RevealBody,
                     db: sqlite3.Connection = Depends(get_db)):
    locations = db.execute(
        "SELECT root_folder, subfolder_path, filename FROM file_locations"
        " WHERE file_id=? ORDER BY id", (file_id,)).fetchall()
    if db.execute("SELECT 1 FROM files WHERE id=?", (file_id,)).fetchone() is None:
        raise HTTPException(404, "file not found")
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
def summarise_all_files(request: Request, db: sqlite3.Connection = Depends(get_db)):
    """Queue background LLM summarisation for all converted files missing keywords/summary."""
    if _summarise_progress["running"]:
        return {"status": "already_running", **_summarise_progress}

    rows = db.execute(
        "SELECT m.file_id FROM markdown_files m"
        " WHERE (m.keywords IS NULL OR m.keywords = '') AND m.content_md IS NOT NULL"
        " ORDER BY m.file_id").fetchall()
    file_ids = [r["file_id"] for r in rows]
    if not file_ids:
        return {"status": "nothing_to_do", "total": 0}

    def _run():
        _summarise_progress.update(running=True, done=0, total=len(file_ids), errors=0)
        from .. import ai
        for fid in file_ids:
            conn = get_conn()
            try:
                md_row = conn.execute(
                    "SELECT content_md FROM markdown_files WHERE file_id=?", (fid,)).fetchone()
                if md_row:
                    kws, summary = ai.summarise_document(md_row["content_md"])
                    conn.execute(
                        "UPDATE markdown_files SET keywords=?, summary=? WHERE file_id=?",
                        (json.dumps(kws), summary, fid))
                    conn.commit()
            except Exception:
                _summarise_progress["errors"] += 1
            finally:
                conn.close()
                _summarise_progress["done"] += 1
        _summarise_progress["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started", "total": len(file_ids)}


@router.post("/files/{file_id}/summarise")
def summarise_file(file_id: int, db: sqlite3.Connection = Depends(get_db)):
    """(Re)generate keywords + summary for a file that already has markdown."""
    import json as _json
    from .. import ai
    md_row = db.execute(
        "SELECT content_md FROM markdown_files WHERE file_id=?", (file_id,)).fetchone()
    if md_row is None:
        raise HTTPException(400, "file has no converted markdown")
    try:
        keywords, summary = ai.summarise_document(md_row["content_md"])
        db.execute(
            "UPDATE markdown_files SET keywords=?, summary=? WHERE file_id=?",
            (_json.dumps(keywords), summary, file_id))
        db.commit()
        return {"ok": True, "keywords": keywords, "summary": summary}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/files/{file_id}/retry")
def retry_conversion(file_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT original_name, content FROM files WHERE id=?", (file_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "file not found")
    try:
        md, used = convert.convert_to_markdown(row["original_name"], row["content"])
        store.save_markdown(db, file_id, md, used)
        return {"status": "converted"}
    except convert.ConversionError as exc:
        store.set_status(db, file_id, "failed", str(exc))
        return {"status": "failed", "error": str(exc)}


@router.delete("/files")
def delete_all_files(db: sqlite3.Connection = Depends(get_db)):
    count = db.execute("SELECT count(*) c FROM files").fetchone()["c"]
    db.execute("DELETE FROM files")
    db.commit()
    return {"ok": True, "deleted": count}


@router.delete("/files/{file_id}")
def delete_file(file_id: int, db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM files WHERE id=?", (file_id,)).fetchone() is None:
        raise HTTPException(404, "file not found")
    db.execute("DELETE FROM files WHERE id=?", (file_id,))
    db.commit()
    return {"ok": True}


@router.post("/documents/{doc_id}/reprocess")
def reprocess_document(doc_id: int, db=Depends(get_db)):
    """Delete old chunks and re-run the full pipeline for this document."""
    row = db.execute(
        "SELECT id, original_filename, storage_path FROM documents WHERE id=%s",
        (doc_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "document not found")
    storage_path = row["storage_path"]
    if not storage_path or not Path(storage_path).exists():
        raise HTTPException(400, "original file not found on disk — cannot reprocess")
    content = Path(storage_path).read_bytes()
    db.execute("DELETE FROM document_chunks WHERE document_id=%s", (doc_id,))
    db.execute(
        "UPDATE documents SET processing_status='uploaded', processing_error=NULL,"
        " extracted_text=NULL, processed_at=NULL WHERE id=%s", (doc_id,))
    db.commit()
    import threading
    from ..pipeline import process_document
    threading.Thread(
        target=process_document,
        args=(doc_id, row["original_filename"], content),
        daemon=True).start()
    return {"started": True, "document_id": doc_id}
