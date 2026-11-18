"""FastAPI application entrypoint for WLED Calendar."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.db import init_db
from backend.routers import controller, effects, feeds, schedule
from backend.scheduler import start_scheduler, stop_scheduler
from backend.wled_client import sync_controller_profile

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize SQLite, sync WLED controller profile if reachable, and run scheduler."""
    init_db()
    try:
        await sync_controller_profile()
    except Exception as exc:
        logger.warning("WLED controller not reachable on startup: %s", exc)
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(title="WLED Calendar", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(controller.router)
app.include_router(effects.router)
app.include_router(schedule.router)
app.include_router(feeds.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Simple healthcheck endpoint."""
    return {"status": "ok"}


FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str) -> FileResponse:
        """Serve built React SPA for all non-API routes."""
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
