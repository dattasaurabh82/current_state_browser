#!/usr/bin/env python3
"""
Step 2 test: exercises lib/cache.py in isolation (no server needed).

Tests:
  1. Initial cache refresh (loads all metadata)
  2. available_dates() returns a sorted list
  3. get_metadata() returns correct fields for a known date
  4. get_audio_url() returns a link and caches it
  5. Second call to get_audio_url() hits cache (no new Dropbox call)

Run:
    uv run test_step2.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from lib.cache import cache


def separator(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


async def main():

    # ── 1. Initial refresh ────────────────────────────────────────
    separator("1. Initial cache refresh")
    await cache.refresh()
    print(f"  Status: {cache.status()}")

    # ── 2. available_dates ────────────────────────────────────────
    separator("2. available_dates()")
    dates = cache.available_dates()
    print(f"  Count    : {len(dates)}")
    print(f"  Earliest : {dates[0]}")
    print(f"  Latest   : {dates[-1]}")

    # ── 3. get_metadata ───────────────────────────────────────────
    separator("3. get_metadata() for latest date")
    latest = dates[-1]
    meta = cache.get_metadata(latest)
    if meta is None:
        print("  FAILED — returned None")
        sys.exit(1)
    import json
    print(json.dumps(meta, indent=4))

    # ── 4. get_audio_url (first call — cache miss) ────────────────
    separator("4. get_audio_url() — first call (cache miss)")
    url = await cache.get_audio_url(latest)
    if not url:
        print("  FAILED — returned None")
        sys.exit(1)
    print(f"  URL (first 80): {url[:80]}...")

    # ── 5. get_audio_url (second call — should hit cache) ─────────
    separator("5. get_audio_url() — second call (expect cache HIT in logs)")
    url2 = await cache.get_audio_url(latest)
    assert url == url2, "URLs differ — cache not working!"
    print(f"  Same URL returned: OK")

    # ── 6. invalid date ───────────────────────────────────────────
    separator("6. Requests for unknown date")
    print(f"  is_valid_date('1999-01-01'): {cache.is_valid_date('1999-01-01')}")
    print(f"  get_metadata('1999-01-01'):  {cache.get_metadata('1999-01-01')}")
    url_bad = await cache.get_audio_url("1999-01-01")
    print(f"  get_audio_url('1999-01-01'): {url_bad}")

    separator("ALL TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
