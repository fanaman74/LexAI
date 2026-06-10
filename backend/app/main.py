import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


def create_app() -> FastAPI:
    app = FastAPI(title="LexAIv2")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    from .routers import (analyses as analyses_router, cases as cases_router,
                          chats as chats_router, files as files_router,
                          scan as scan_router, search as search_router,
                          semantic as semantic_router, tags as tags_router,
                          upload as upload_router)
    app.include_router(scan_router.router)
    app.include_router(upload_router.router)
    app.include_router(files_router.router)
    app.include_router(search_router.router)
    app.include_router(tags_router.router)
    app.include_router(analyses_router.router)
    app.include_router(semantic_router.router)
    app.include_router(chats_router.router)
    app.include_router(cases_router.router)

    if FRONTEND_DIST.is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_spa(full_path: str):
            index = FRONTEND_DIST / "index.html"
            return FileResponse(str(index))

    return app


app = create_app()
