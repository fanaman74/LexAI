import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import convert, indexer, store
from .db import get_conn, init_db

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
    def __init__(self, root: str, db_path: str):
        self.id = uuid.uuid4().hex[:12]
        self.root = Path(root)
        self.db_path = db_path
        self._lock = threading.Lock()
        self._progress = {
            "status": "scanning", "root": str(root), "total": 0, "done": 0,
            "new": 0, "existing": 0, "converted": 0, "failed": 0, "ocr": 0,
            "skipped": [], "error": None,
        }

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
            conn = get_conn(self.db_path)
            init_db(conn)
            conn.close()
            supported, skipped = scan_folder(self.root)
            self._bump(status="converting", total=len(supported), skipped=skipped)
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = [pool.submit(self._process_one, p) for p in supported]
                for fut in as_completed(futures):
                    fut.result()
            self._bump(status="done")
            indexer.start(self.db_path)  # local embeddings need no API key
        except Exception as exc:
            self._bump(status="done", error=str(exc))

    def _process_one(self, path: Path):
        conn = get_conn(self.db_path)
        try:
            content = path.read_bytes()
            file_id, created = store.upsert_file(conn, path.name, content)
            subfolder = str(path.parent.relative_to(self.root))
            store.add_location(conn, file_id, str(self.root),
                               "" if subfolder == "." else subfolder, path.name)
            self._bump(**{"new" if created else "existing": 1})

            status = conn.execute(
                "SELECT status FROM files WHERE id=?", (file_id,)).fetchone()["status"]
            if status in ("pending", "failed", "needs_ocr"):
                try:
                    md, used = convert.convert_to_markdown(path.name, content)
                    store.save_markdown(conn, file_id, md, used)
                    self._bump(converted=1, **({"ocr": 1} if used == "ocr" else {}))
                except convert.ConversionError as exc:
                    store.set_status(conn, file_id, "failed", str(exc))
                    self._bump(failed=1)
        except Exception:
            self._bump(failed=1)
        finally:
            self._bump(done=1)
            conn.close()


def start_scan(root: str, db_path: str) -> str:
    job = IngestJob(root, db_path)
    JOBS[job.id] = job
    threading.Thread(target=job.run, daemon=True).start()
    return job.id
