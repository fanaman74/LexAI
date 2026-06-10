import os
import shutil
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import convert, store
from .db import get_conn
from .pipeline import _run_pipeline

JOBS: dict[str, "IngestJob"] = {}
MAX_WORKERS = 4


def scan_folder(root) -> tuple[list[Path], list[str]]:
    """Recursively find files. Returns (supported paths, skipped rel-paths)."""
    root = Path(root)
    supported, skipped = [], []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name.startswith("."):
            continue
        if p.suffix.lower() in convert.SUPPORTED_EXTENSIONS:
            supported.append(p)
        else:
            skipped.append(str(p.relative_to(root)))
    return supported, skipped


class IngestJob:
    def __init__(self, root: str):
        self.id = uuid.uuid4().hex[:12]
        self.root = Path(root)
        self._lock = threading.Lock()
        self._progress = {
            "status": "scanning", "root": str(root), "total": 0, "done": 0,
            "new": 0, "existing": 0, "converted": 0, "failed": 0, "ocr": 0,
            "skipped": [], "error": None,
        }
        self.cleanup_root: str | None = None
        self.case_id: int | None = None

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._progress)

    def _bump(self, **deltas):
        with self._lock:
            for key, val in deltas.items():
                if isinstance(val, int) and not isinstance(val, bool):
                    self._progress[key] += val
                else:
                    self._progress[key] = val

    def run(self):
        try:
            supported, skipped = scan_folder(self.root)
            self._bump(status="converting", total=len(supported), skipped=skipped)
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = [pool.submit(self._process_one, p) for p in supported]
                for fut in as_completed(futures):
                    fut.result()
            self._bump(status="done")
        except Exception as exc:
            self._bump(status="done", error=str(exc))
        finally:
            if self.cleanup_root:
                shutil.rmtree(self.cleanup_root, ignore_errors=True)

    def _process_one(self, path: Path):
        conn = get_conn()
        try:
            content = path.read_bytes()
            doc_id, created = store.upsert_document(conn, path.name, content)
            subfolder = str(path.parent.relative_to(self.root))
            store.add_location(conn, doc_id, str(self.root),
                               "" if subfolder == "." else subfolder, path.name)
            if self.case_id is not None:
                try:
                    conn.execute(
                        "INSERT INTO case_documents (case_id, document_id) VALUES (%s,%s)"
                        " ON CONFLICT DO NOTHING",
                        (self.case_id, doc_id))
                    conn.commit()
                except Exception:
                    pass
            self._bump(**{"new" if created else "existing": 1})

            status_row = conn.execute(
                "SELECT processing_status FROM documents WHERE id=%s",
                (doc_id,)).fetchone()
            current_status = (status_row["processing_status"]
                              if status_row else "uploaded")

            if current_status in ("uploaded", "failed", "extracting"):
                try:
                    _run_pipeline(conn, doc_id, path.name, content, parent_id=None)
                    self._bump(converted=1)
                except Exception as exc:
                    store.set_status(conn, doc_id, "failed", str(exc))
                    self._bump(failed=1)
        except Exception:
            self._bump(failed=1)
        finally:
            self._bump(done=1)
            conn.close()


def start_scan(root: str, case_id: int | None = None) -> str:
    job = IngestJob(root)
    job.case_id = case_id
    JOBS[job.id] = job
    threading.Thread(target=job.run, daemon=True).start()
    return job.id
