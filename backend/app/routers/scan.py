import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import ingest

router = APIRouter(prefix="/api")


class ScanRequest(BaseModel):
    path: str


@router.post("/scan")
def start_scan(body: ScanRequest, request: Request):
    if not Path(body.path).is_dir():
        raise HTTPException(400, f"not a folder: {body.path}")
    job_id = ingest.start_scan(body.path, request.app.state.db_path)
    return {"job_id": job_id}


@router.get("/scan/{job_id}")
def scan_progress(job_id: str):
    job = ingest.JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    return job.snapshot()


@router.post("/pick-folder")
def pick_folder():
    """Open a native macOS folder picker; returns {"path": ...} or {"path": None}."""
    script = ('POSIX path of (choose folder with prompt '
              '"Select a folder of legal files to ingest")')
    try:
        proc = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True, timeout=300)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"path": None}
    if proc.returncode != 0:
        return {"path": None}  # user cancelled
    return {"path": proc.stdout.strip()}
