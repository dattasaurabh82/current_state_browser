"""
Dropbox client for current_state_browser.

Handles:
- OAuth2 token refresh (CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN)
- Listing all files in the backup folder
- Building a map of complete date entries (wav + zip both present)
- Fetching a Dropbox temporary link for audio streaming
- Downloading + parsing a generation_results zip in memory

Architecture note:
  Audio is never proxied through this server. Instead we call
  get_temporary_link() which returns a Dropbox-hosted HTTPS URL
  valid for 4 hours. The browser streams audio directly from
  Dropbox. This keeps the server out of the audio data path and
  handles any number of concurrent listeners safely.
"""

import io
import json
import os
import re
import zipfile
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
from loguru import logger

# ── Constants ─────────────────────────────────────────────────────────────────

DROPBOX_FOLDER = "/currentStateMusicFilesBKP"
TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder"
LIST_CONTINUE_URL = "https://api.dropboxapi.com/2/files/list_folder/continue"
TEMP_LINK_URL = "https://api.dropboxapi.com/2/files/get_temporary_link"
DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download"

# Filename patterns
ZIP_DATE_RE = re.compile(r"generation_results_(\d{4}-\d{2}-\d{2})\.zip$")
WAV_DATE_RE = re.compile(r"_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.wav$")

ENV_FILE = Path(__file__).parent.parent / ".env"


# ── Auth ──────────────────────────────────────────────────────────────────────


def _load_credentials() -> dict:
    load_dotenv(ENV_FILE)
    creds = {
        "client_id": os.getenv("DROPBOX_CLIENT_ID"),
        "client_secret": os.getenv("DROPBOX_CLIENT_SECRET"),
        "refresh_token": os.getenv("DROPBOX_REFRESH_TOKEN"),
    }
    missing = [k for k, v in creds.items() if not v]
    if missing:
        raise RuntimeError(f"Missing Dropbox credentials in .env: {', '.join(missing)}")
    return creds


def get_access_token() -> str:
    """
    Exchange the stored refresh token for a short-lived access token.
    Called fresh on each cache refresh cycle — tokens last ~4 hours
    but we refresh the cache every 30 min so this is always valid.
    """
    creds = _load_credentials()
    logger.debug("Requesting fresh Dropbox access token...")
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": creds["refresh_token"],
            "client_id": creds["client_id"],
            "client_secret": creds["client_secret"],
        },
        timeout=30,
    )
    resp.raise_for_status()
    token = resp.json()["access_token"]
    logger.debug("Dropbox access token obtained.")
    return token


# ── File listing ──────────────────────────────────────────────────────────────


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def list_all_dropbox_files(token: str) -> list[dict]:
    """Return every file entry in DROPBOX_FOLDER, handling pagination."""
    entries = []
    url = LIST_FOLDER_URL
    data: dict = {"path": DROPBOX_FOLDER, "limit": 2000}

    while True:
        resp = requests.post(url, headers=_auth_headers(token), json=data, timeout=30)

        if resp.status_code == 409:
            logger.warning(f"Dropbox folder '{DROPBOX_FOLDER}' not found.")
            return []

        resp.raise_for_status()
        result = resp.json()
        entries.extend(e for e in result.get("entries", []) if e[".tag"] == "file")

        if not result.get("has_more"):
            break

        url = LIST_CONTINUE_URL
        data = {"cursor": result["cursor"]}

    logger.info(f"Dropbox listing: {len(entries)} files found.")
    return entries


def _extract_date(name: str) -> Optional[str]:
    m = ZIP_DATE_RE.search(name) or WAV_DATE_RE.search(name)
    return m.group(1) if m else None


def _wav_timestamp(name: str) -> str:
    """
    Extract sortable timestamp string from wav filename.
    e.g. world_theme_2026-03-05_03-01-07.wav -> '2026-03-05_03-01-07'
    Used to pick the latest wav when multiple exist on the same date.
    """
    m = WAV_DATE_RE.search(name)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    return ""


def build_date_map(entries: list[dict]) -> dict[str, dict]:
    """
    From a raw Dropbox file listing, build a dict keyed by date string.
    Only dates with BOTH a wav and a zip are included (complete pairs).

    Returns:
        {
          "2026-01-09": {
            "wav_path": "/currentStateMusicFilesBKP/world_theme_2026-01-09_03-00-11.wav",
            "zip_path": "/currentStateMusicFilesBKP/generation_results_2026-01-09.zip",
          },
          ...
        }
    """
    # First pass: group by date
    by_date: dict[str, dict] = {}

    for e in entries:
        name = e["name"]
        date = _extract_date(name)
        if not date:
            continue

        if date not in by_date:
            by_date[date] = {"wavs": [], "zips": []}

        if name.endswith(".zip"):
            by_date[date]["zips"].append(e["path_lower"])
        elif name.endswith(".wav"):
            by_date[date]["wavs"].append(e["path_lower"])

    # Second pass: keep only complete pairs, pick latest wav if multiple
    complete: dict[str, dict] = {}
    for date, files in sorted(by_date.items()):
        if not files["wavs"] or not files["zips"]:
            logger.debug(
                f"Skipping incomplete date: {date} "
                f"(wav={len(files['wavs'])}, zip={len(files['zips'])})"
            )
            continue

        # Pick latest wav by timestamp embedded in filename
        best_wav = max(files["wavs"], key=lambda p: _wav_timestamp(Path(p).name))

        complete[date] = {
            "wav_path": best_wav,
            "zip_path": files["zips"][0],  # always exactly one zip per date
        }

    logger.info(f"Complete date entries: {len(complete)}")
    return complete


# ── Audio temp link ───────────────────────────────────────────────────────────


def get_audio_temp_link(token: str, dropbox_path: str) -> str:
    """
    Ask Dropbox for a temporary HTTPS link to the wav file.
    Valid for 4 hours. The browser streams directly from this URL —
    the server is not in the audio data path.
    """
    resp = requests.post(
        TEMP_LINK_URL,
        headers=_auth_headers(token),
        json={"path": dropbox_path},
        timeout=15,
    )
    resp.raise_for_status()
    link = resp.json()["link"]
    logger.debug(f"Temp link obtained for {dropbox_path}")
    return link


# ── Metadata (zip) ────────────────────────────────────────────────────────────


def fetch_and_parse_zip(token: str, dropbox_path: str) -> Optional[dict]:
    """
    Download the generation_results zip entirely into memory,
    extract pipeline_results.json, and return the parsed dict.
    Nothing is written to disk.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Dropbox-API-Arg": json.dumps({"path": dropbox_path}),
    }

    resp = requests.post(DOWNLOAD_URL, headers=headers, timeout=60)
    if not resp.ok:
        logger.error(f"Failed to download zip {dropbox_path}: {resp.status_code}")
        return None

    try:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            if "pipeline_results.json" not in zf.namelist():
                logger.warning(f"pipeline_results.json not found in {dropbox_path}")
                return None
            with zf.open("pipeline_results.json") as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Failed to parse zip {dropbox_path}: {e}")
        return None


def extract_display_metadata(raw: dict) -> dict:
    """
    Distil pipeline_results.json down to the fields shown in the UI.

    Kept fields:
      date, summary, dominant_themes, energy_level,
      tension_level, hope_factor, primary_archetype, prompt_natural
    """
    analysis = raw.get("analysis", {})
    selection = raw.get("selection", {})
    prompt = raw.get("prompt", {})

    return {
        "date": raw.get("date", ""),
        "summary": analysis.get("summary", ""),
        "dominant_themes": analysis.get("dominant_themes", []),
        "energy_level": analysis.get("energy_level", ""),
        "tension_level": analysis.get("tension_level", 0),
        "hope_factor": analysis.get("hope_factor", 0),
        "primary_archetype": selection.get("primary", ""),
        "prompt_natural": prompt.get("prompt_natural", ""),
    }
