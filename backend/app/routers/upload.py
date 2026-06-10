import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile

from .. import ingest

router = APIRouter(prefix="/api")


@router.post("/upload")
async def upload_files(files: list[UploadFile], request: Request):
    tmp_dir = tempfile.mkdtemp(prefix="lexai_upload_")
    for file in files:
        dest = Path(tmp_dir) / (file.filename or "upload")
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    job_id = ingest.start_scan(tmp_dir, request.app.state.db_path)
    return {"job_id": job_id}
