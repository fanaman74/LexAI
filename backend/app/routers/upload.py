import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile

from .. import ingest

router = APIRouter(prefix="/api")


@router.post("/upload")
async def upload_files(files: list[UploadFile], request: Request):
    tmp_dir = tempfile.mkdtemp(prefix="lexai_upload_")
    for i, file in enumerate(files):
        safe_name = Path(file.filename).name if file.filename else "upload"
        sub = Path(tmp_dir) / f"{i:04d}"
        sub.mkdir()
        dest = sub / safe_name
        dest.write_bytes(await file.read())
    job = ingest.IngestJob(tmp_dir, request.app.state.db_path)
    job.cleanup_root = tmp_dir
    ingest.JOBS[job.id] = job
    threading.Thread(target=job.run, daemon=True).start()
    return {"job_id": job.id}
