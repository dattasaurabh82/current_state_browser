"""
current_state_browser — FastAPI server

Routes:
  GET /                     → serves static/index.html
  GET /api/dates            → sorted list of available date strings
  GET /api/entry/{date}     → metadata JSON for that date
  GET /api/audio/{date}     → { "url": "<dropbox_temp_link>" }
  GET /api/status           → cache health / debug info
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from lib.cache import cache, start_cache

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load cache on startup. Nothing special needed on shutdown."""
    logger.info("Server starting up — loading cache...")
    await start_cache(app)
    logger.info("Server ready.")
    yield
    logger.info("Server shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="current_state browser",
    description="Archive radio for AI-generated ambient music based on daily world news.",
    version="0.1.0",
    lifespan=lifespan,
)

# Serve everything in /static at /static (css, js if added later)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root():
    """Serve the single-page UI."""
    index = STATIC_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(index)


@app.get("/api/dates")
async def get_dates():
    """
    Return all available dates in ascending order.
    These are the only dates with both a wav and metadata zip in Dropbox.
    """
    dates = cache.available_dates()
    logger.info(f"GET /api/dates — returning {len(dates)} dates")
    return JSONResponse({"dates": dates, "count": len(dates)})


@app.get("/api/entry/{date}")
async def get_entry(date: str):
    """
    Return display metadata for a given date (YYYY-MM-DD).
    Returns 404 if the date has no complete entry.
    """
    if not cache.is_valid_date(date):
        logger.warning(f"GET /api/entry/{date} — not found")
        raise HTTPException(status_code=404, detail=f"No entry for date: {date}")

    meta = cache.get_metadata(date)
    if meta is None:
        logger.error(f"GET /api/entry/{date} — date in map but metadata missing")
        raise HTTPException(status_code=500, detail="Metadata unavailable")

    logger.info(f"GET /api/entry/{date} — OK")
    return JSONResponse(meta)


@app.get("/api/audio/{date}")
async def get_audio(date: str):
    """
    Return a short-lived Dropbox temp link for the wav file.
    The browser streams audio directly from Dropbox — this server
    is not in the audio data path.
    Link is cached server-side for 3.5 hours.
    """
    if not cache.is_valid_date(date):
        logger.warning(f"GET /api/audio/{date} — not found")
        raise HTTPException(status_code=404, detail=f"No audio for date: {date}")

    url = await cache.get_audio_url(date)
    if not url:
        logger.error(f"GET /api/audio/{date} — failed to get temp link")
        raise HTTPException(status_code=500, detail="Could not get audio link")

    logger.info(f"GET /api/audio/{date} — OK")
    return JSONResponse({"url": url, "date": date})


@app.get("/api/status")
async def get_status():
    """Debug / health endpoint. Returns cache state."""
    status = cache.status()
    logger.debug(f"GET /api/status — {status}")
    return JSONResponse(status)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    logger.info(f"Starting server on port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
