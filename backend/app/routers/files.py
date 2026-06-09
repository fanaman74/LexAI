import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response

from .. import convert, store
from ..deps import get_db

router = APIRouter(prefix="/api")

LIST_COLUMNS = """f.id, f.original_name, f.file_type, f.size_bytes, f.status,
  f.error_message, f.created_at,
  (SELECT json_group_array(json_object('root_folder', l.root_folder,
     'subfolder_path', l.subfolder_path, 'filename', l.filename))
   FROM file_locations l WHERE l.file_id = f.id) AS locations,
  (SELECT json_group_array(t.name) FROM file_tags ft
   JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = f.id) AS tags"""


def _row_to_file(row) -> dict:
    d = dict(row)
    d["locations"] = json.loads(d["locations"])
    d["tags"] = sorted(json.loads(d["tags"]))
    return d


@router.get("/files")
def list_files(folder: str | None = None, file_type: str | None = None,
               status: str | None = None, tag: str | None = None,
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
        "SELECT content_md, converter_used, converted_at, word_count"
        " FROM markdown_files WHERE file_id=?", (file_id,)).fetchone()
    detail["markdown"] = dict(md) if md else None
    detail["tags"] = sorted(r["name"] for r in db.execute(
        "SELECT t.name FROM file_tags ft JOIN tags t ON t.id=ft.tag_id"
        " WHERE ft.file_id=?", (file_id,)).fetchall())
    detail["notes"] = [dict(r) for r in db.execute(
        "SELECT id, content, created_at FROM notes WHERE file_id=?"
        " ORDER BY created_at DESC, id DESC", (file_id,)).fetchall()]
    return detail


@router.get("/files/{file_id}/original")
def download_original(file_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT original_name, content FROM files WHERE id=?", (file_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "file not found")
    return Response(
        content=row["content"], media_type="application/octet-stream",
        headers={"Content-Disposition":
                 f'attachment; filename="{row["original_name"]}"'})


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
