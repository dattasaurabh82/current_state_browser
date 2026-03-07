#!/usr/bin/env python3
"""
PoC Dropbox probe script for current_state_browser.

Lists all files in /currentStateMusicFilesBKP, groups them by date,
and prints a structured summary so we can design the server.

Run:
    uv run dropbox_probe.py
"""

import json
import os
import re
from collections import defaultdict
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── Config ────────────────────────────────────────────────────────────────────
DROPBOX_FOLDER = "/currentStateMusicFilesBKP"
ENV_FILE = Path(__file__).parent / ".env"

# ── Auth ──────────────────────────────────────────────────────────────────────


def _load_env():
    load_dotenv(ENV_FILE)
    client_id = os.getenv("DROPBOX_CLIENT_ID")
    client_secret = os.getenv("DROPBOX_CLIENT_SECRET")
    refresh_token = os.getenv("DROPBOX_REFRESH_TOKEN")

    missing = [
        k
        for k, v in {
            "DROPBOX_CLIENT_ID": client_id,
            "DROPBOX_CLIENT_SECRET": client_secret,
            "DROPBOX_REFRESH_TOKEN": refresh_token,
        }.items()
        if not v
    ]

    if missing:
        raise RuntimeError(f"Missing in .env: {', '.join(missing)}")

    return client_id, client_secret, refresh_token


def get_access_token() -> str:
    client_id, client_secret, refresh_token = _load_env()
    print("Refreshing Dropbox access token...")
    resp = requests.post(
        "https://api.dropboxapi.com/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=30,
    )
    resp.raise_for_status()
    token = resp.json()["access_token"]
    print("  Token obtained\n")
    return token


# ── Dropbox listing ───────────────────────────────────────────────────────────


def list_all_files(token: str) -> list:
    """List every file in DROPBOX_FOLDER, handling pagination."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    entries = []
    url = "https://api.dropboxapi.com/2/files/list_folder"
    data = {"path": DROPBOX_FOLDER, "limit": 2000}

    while True:
        resp = requests.post(url, headers=headers, json=data, timeout=30)

        if resp.status_code == 409:
            print(f"Folder '{DROPBOX_FOLDER}' does not exist yet.")
            return []

        resp.raise_for_status()
        result = resp.json()

        entries.extend(e for e in result.get("entries", []) if e[".tag"] == "file")

        if not result.get("has_more"):
            break

        # Continue pagination
        url = "https://api.dropboxapi.com/2/files/list_folder/continue"
        data = {"cursor": result["cursor"]}

    return entries


# ── Date extraction ───────────────────────────────────────────────────────────

# generation_results_2026-03-06.zip  ->  2026-03-06
ZIP_DATE_RE = re.compile(r"generation_results_(\d{4}-\d{2}-\d{2})\.zip$")
# world_theme_2026-03-05_03-01-07.wav  ->  2026-03-05
WAV_DATE_RE = re.compile(r"_(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}\.wav$")


def extract_date(name: str):
    m = ZIP_DATE_RE.search(name) or WAV_DATE_RE.search(name)
    return m.group(1) if m else None


# ── Main ──────────────────────────────────────────────────────────────────────


def main():
    token = get_access_token()

    print(f"Listing files in Dropbox: {DROPBOX_FOLDER}")
    entries = list_all_files(token)
    print(f"  Total files found: {len(entries)}\n")

    # Group by date
    by_date = defaultdict(lambda: {"wav": [], "zip": [], "other": []})

    for e in entries:
        name = e["name"]
        size = e.get("size", 0)
        date = extract_date(name)

        record = {"name": name, "size_bytes": size, "path": e["path_lower"]}

        if date:
            if name.endswith(".zip"):
                by_date[date]["zip"].append(record)
            elif name.endswith(".wav"):
                by_date[date]["wav"].append(record)
            else:
                by_date[date]["other"].append(record)
        else:
            by_date["_undated"]["other"].append(record)

    # ── Summary ──────────────────────────────────────────────────────────────
    dates_sorted = sorted(
        (d for d in by_date if d != "_undated"),
    )

    print("=" * 60)
    print("DATE SUMMARY")
    print("=" * 60)

    complete_days = 0
    incomplete_days = 0

    for d in dates_sorted:
        info = by_date[d]
        wav_count = len(info["wav"])
        zip_count = len(info["zip"])
        flag = "OK" if wav_count >= 1 and zip_count >= 1 else "!!"
        if wav_count >= 1 and zip_count >= 1:
            complete_days += 1
        else:
            incomplete_days += 1
        print(f"  [{flag}] {d}  |  wav={wav_count}  zip={zip_count}")

    print()
    print(f"  Total dates            : {len(dates_sorted)}")
    print(f"  Complete (wav + zip)   : {complete_days}")
    print(f"  Incomplete             : {incomplete_days}")
    if dates_sorted:
        print(f"  Earliest date          : {dates_sorted[0]}")
        print(f"  Latest date            : {dates_sorted[-1]}")

    # ── Undated ───────────────────────────────────────────────────────────────
    if "_undated" in by_date:
        print(f"\n  Undated / unrecognised files : {len(by_date['_undated']['other'])}")
        for r in by_date["_undated"]["other"]:
            print(f"    - {r['name']}")

    # ── Full JSON dump ────────────────────────────────────────────────────────
    output = {
        "folder": DROPBOX_FOLDER,
        "total_files": len(entries),
        "dates": {d: by_date[d] for d in dates_sorted},
    }
    if "_undated" in by_date:
        output["undated"] = by_date["_undated"]

    dump_path = Path(__file__).parent / "dropbox_probe_result.json"
    with open(dump_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nFull JSON dump written to: {dump_path}")
    print("Share that file (or paste its contents) to continue planning.")


if __name__ == "__main__":
    main()
