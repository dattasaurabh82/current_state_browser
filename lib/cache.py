"""
In-memory cache for current_state_browser.

Responsibilities:
- On startup: fetch full date map + all metadata from Dropbox
- Background task: refresh every 30 minutes
- Audio temp links: generate on demand, cache for 3.5h per date

Why in-memory (not disk):
  ~40 entries, each metadata payload is a few hundred bytes.
  Total in-memory cost is negligible. No disk I/O, no stale files,
  works cleanly on Render's ephemeral filesystem.

Refresh cycle (30 min):
  Dropbox token is refreshed at the start of each cycle.
  A fresh token is valid for ~4 hours so this is well within limits.

Audio link cache (3.5h TTL):
  Dropbox temporary links are valid for 4 hours. We cache them for
  3.5h to give a safe 30min buffer before expiry. On cache miss
  (first request or after expiry) we call get_temporary_link once
  and store the result. Multiple concurrent users hitting the same
  date all get the same cached link — Dropbox is not called again
  until it expires.
"""

import asyncio
import time
from typing import Optional

from loguru import logger

from lib.dropbox_client import (
    build_date_map,
    extract_display_metadata,
    fetch_and_parse_zip,
    get_access_token,
    get_audio_temp_link,
    list_all_dropbox_files,
)

# ── Config ────────────────────────────────────────────────────────────────────

REFRESH_INTERVAL_SEC = 30 * 60  # 30 minutes
AUDIO_LINK_TTL_SEC = 3.5 * 60 * 60  # 3.5 hours


# ── State ─────────────────────────────────────────────────────────────────────


class AppCache:
    """
    Single shared cache instance. Holds the date map, all metadata,
    and audio temp links with TTL.
    """

    def __init__(self):
        # date -> { wav_path, zip_path }
        self._date_map: dict[str, dict] = {}

        # date -> display metadata dict
        self._metadata: dict[str, dict] = {}

        # date -> { url: str, expires_at: float }
        self._audio_links: dict[str, dict] = {}

        # Last successful refresh timestamp
        self._last_refresh: Optional[float] = None

        # Current valid token (refreshed each cycle)
        self._token: Optional[str] = None

        self._lock = asyncio.Lock()

    # ── Public accessors ──────────────────────────────────────────────────────

    def available_dates(self) -> list[str]:
        """Sorted list of complete dates (oldest first)."""
        return sorted(self._date_map.keys())

    def get_metadata(self, date: str) -> Optional[dict]:
        return self._metadata.get(date)

    def is_valid_date(self, date: str) -> bool:
        return date in self._date_map

    # ── Audio link (on-demand with TTL cache) ─────────────────────────────────

    async def get_audio_url(self, date: str) -> Optional[str]:
        """
        Return a valid Dropbox temp link for the given date.
        Generates a new one if not cached or expired.
        """
        if date not in self._date_map:
            return None

        now = time.time()
        cached = self._audio_links.get(date)

        if cached and cached["expires_at"] > now:
            logger.debug(f"Audio link cache hit for {date}")
            return cached["url"]

        # Cache miss or expired — fetch new link
        async with self._lock:
            # Double-check after acquiring lock (another coroutine may have refreshed)
            cached = self._audio_links.get(date)
            if cached and cached["expires_at"] > now:
                return cached["url"]

            logger.info(f"Fetching new audio temp link for {date}")
            try:
                token = await self._ensure_token()
                wav_path = self._date_map[date]["wav_path"]
                url = await asyncio.to_thread(get_audio_temp_link, token, wav_path)
                self._audio_links[date] = {
                    "url": url,
                    "expires_at": now + AUDIO_LINK_TTL_SEC,
                }
                return url
            except Exception as e:
                logger.error(f"Failed to get audio link for {date}: {e}")
                return None

    # ── Refresh ───────────────────────────────────────────────────────────────

    async def _ensure_token(self) -> str:
        """Get or refresh the Dropbox token (blocking call wrapped in thread)."""
        if not self._token:
            self._token = await asyncio.to_thread(get_access_token)
        return self._token

    async def refresh(self):
        """
        Full refresh: re-list Dropbox, rebuild date map, reload all metadata.
        Called on startup and then every REFRESH_INTERVAL_SEC.
        """
        logger.info("Cache refresh starting...")
        start = time.time()

        try:
            # Always get a fresh token at refresh time
            token = await asyncio.to_thread(get_access_token)
            self._token = token

            # Re-list Dropbox
            entries = await asyncio.to_thread(list_all_dropbox_files, token)
            date_map = await asyncio.to_thread(build_date_map, entries)

            # Fetch metadata for any date we don't have yet
            new_dates = set(date_map.keys()) - set(self._metadata.keys())
            if new_dates:
                logger.info(f"Fetching metadata for {len(new_dates)} new date(s)...")
            else:
                logger.info("No new dates found.")

            for date in sorted(new_dates):
                zip_path = date_map[date]["zip_path"]
                raw = await asyncio.to_thread(fetch_and_parse_zip, token, zip_path)
                if raw:
                    self._metadata[date] = extract_display_metadata(raw)
                    logger.debug(f"  Loaded metadata for {date}")
                else:
                    logger.warning(f"  Could not load metadata for {date}, skipping")
                    date_map.pop(date, None)  # exclude from date map too

            # Remove dates that have disappeared from Dropbox
            removed = set(self._date_map.keys()) - set(date_map.keys())
            for date in removed:
                logger.info(f"Date removed from Dropbox: {date}")
                self._metadata.pop(date, None)
                self._audio_links.pop(date, None)

            self._date_map = date_map
            self._last_refresh = time.time()

            elapsed = time.time() - start
            logger.info(
                f"Cache refresh complete in {elapsed:.1f}s — "
                f"{len(self._date_map)} dates available"
            )

        except Exception as e:
            logger.error(f"Cache refresh failed: {e}")
            raise

    def status(self) -> dict:
        """Quick status snapshot for health/debug endpoint."""
        return {
            "dates_loaded": len(self._date_map),
            "last_refresh": self._last_refresh,
            "audio_links_cached": len(self._audio_links),
        }


# ── Singleton + background task ───────────────────────────────────────────────

cache = AppCache()


async def start_cache(app):
    """
    FastAPI lifespan startup hook.
    Runs initial refresh then schedules periodic background refresh.
    """
    logger.info("Running initial cache load...")
    await cache.refresh()
    logger.info("Initial cache load done. Starting background refresh task.")
    asyncio.create_task(_background_refresh())


async def _background_refresh():
    """Loop forever: sleep REFRESH_INTERVAL_SEC then refresh."""
    while True:
        await asyncio.sleep(REFRESH_INTERVAL_SEC)
        logger.info("Background cache refresh triggered.")
        try:
            await cache.refresh()
        except Exception as e:
            logger.error(f"Background refresh error (will retry next cycle): {e}")
