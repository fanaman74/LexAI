import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .db import get_conn, init_db

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = os.environ.get("LEXAI_DB", str(PROJECT_ROOT / "data" / "lexai.db"))
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


def create_app(db_path: str = DEFAULT_DB) -> FastAPI:
    app = FastAPI(title="LexAIv2")
    app.state.db_path = db_path
    conn = get_conn(db_path)
    init_db(conn)
    conn.close()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    from .routers import scan as scan_router
    app.include_router(scan_router.router)

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="spa")
    return app


app = create_app()
