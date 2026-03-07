#!/usr/bin/env python3
"""
Step 1 test: exercises lib/dropbox_client.py in isolation.

Tests in order:
  1. Token refresh
  2. File listing + date map build
  3. Metadata fetch + parse for the most recent complete date
  4. Temp audio link for the same date

Run:
    uv run test_step1.py
"""

import json
import sys
from pathlib import Path

# Make sure lib/ is importable
sys.path.insert(0, str(Path(__file__).parent))

from lib.dropbox_client import (
    build_date_map,
    extract_display_metadata,
    fetch_and_parse_zip,
    get_access_token,
    get_audio_temp_link,
    list_all_dropbox_files,
)

def separator(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


def main():
    # ── 1. Token ──────────────────────────────────────────────────
    separator("1. Token refresh")
    token = get_access_token()
    print(f"  OK — token starts with: {token[:8]}...")

    # ── 2. Listing + date map ─────────────────────────────────────
    separator("2. File listing + date map")
    entries = list_all_dropbox_files(token)
    print(f"  Raw files   : {len(entries)}")

    date_map = build_date_map(entries)
    dates = sorted(date_map.keys())
    print(f"  Complete dates : {len(dates)}")
    print(f"  Earliest  : {dates[0]}")
    print(f"  Latest    : {dates[-1]}")
    print(f"\n  Sample entry ({dates[-1]}):")
    print(f"    wav: {date_map[dates[-1]]['wav_path']}")
    print(f"    zip: {date_map[dates[-1]]['zip_path']}")

    # ── 3. Metadata fetch ─────────────────────────────────────────
    separator("3. Metadata fetch + parse (latest date)")
    latest = dates[-1]
    raw = fetch_and_parse_zip(token, date_map[latest]["zip_path"])
    if raw is None:
        print("  FAILED — returned None")
        sys.exit(1)

    display = extract_display_metadata(raw)
    print(f"  Parsed OK. Display fields:")
    print(json.dumps(display, indent=4))

    # ── 4. Temp audio link ────────────────────────────────────────
    separator("4. Temp audio link (latest date)")
    link = get_audio_temp_link(token, date_map[latest]["wav_path"])
    print(f"  Link obtained (first 80 chars):")
    print(f"  {link[:80]}...")
    print(f"\n  Paste the full link in a browser to verify audio plays:")
    print(f"  {link}")

    separator("ALL TESTS PASSED")


if __name__ == "__main__":
    main()
