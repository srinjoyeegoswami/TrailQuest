"""
Pan-India landmark harvester — CLI entry point.

Modes:
  --mode=osm     Overpass API → OSM outdoor landmarks for a district
  --mode=reddit  Reddit PRAW + Gemma → community-reported spots across India
  --mode=both    Runs OSM first, then Reddit, merging results

Usage:
  python -m src.workers.india_harvester --mode=osm --district="Andheri" --state="Maharashtra"
  python -m src.workers.india_harvester --mode=reddit --limit=100
  python -m src.workers.india_harvester --mode=both --district="Pune" --state="Maharashtra" --limit=50

Output always writes to data/landmarks/mined_landmarks.json (append + dedup).
curated_landmarks.json is never touched.
"""

import argparse
import json
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

from src.config.settings import settings
from src.workers import overpass_crawler, reddit_crawler

MINED_FILE = Path("data/landmarks/mined_landmarks.json")

_INSERT_SQL = """
    INSERT INTO target_landmarks
        (id, name, category, target_description, location, geofence_radius_meters, source)
    VALUES
        (%(id)s, %(name)s, %(category)s, %(target_description)s,
         ST_SetSRID(ST_Point(%(longitude)s, %(latitude)s), 4326),
         %(geofence_radius_meters)s, %(source)s)
    ON CONFLICT (id) DO NOTHING
"""


def _load_existing() -> list[dict]:
    if not MINED_FILE.exists():
        return []
    try:
        data = json.loads(MINED_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save(records: list[dict]) -> None:
    MINED_FILE.parent.mkdir(parents=True, exist_ok=True)
    MINED_FILE.write_text(
        json.dumps(records, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_to_db(records: list[dict]) -> int:
    """Upserts landmark records into target_landmarks. Returns insert count."""
    try:
        conn = psycopg2.connect(str(settings.database_url), connect_timeout=5)
    except psycopg2.OperationalError:
        print("[harvester] DB unavailable — records saved to JSON only.")
        return 0

    inserted = 0
    try:
        with conn.cursor() as cur:
            for rec in records:
                cur.execute(_INSERT_SQL, rec)
                inserted += cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return inserted


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Pan-India outdoor landmark harvester (OSM + Reddit)."
    )
    parser.add_argument(
        "--mode",
        choices=["osm", "reddit", "both"],
        required=True,
        help="Data source to harvest from.",
    )
    parser.add_argument(
        "--district",
        default="",
        help="District or city name for OSM area query (required for --mode=osm|both).",
    )
    parser.add_argument(
        "--state",
        default="",
        help="State name for OSM area query (required for --mode=osm|both).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Max Reddit posts to fetch (used with --mode=reddit|both).",
    )
    parser.add_argument(
        "--out",
        default=str(MINED_FILE),
        help="Output JSON file path. Defaults to data/landmarks/mined_landmarks.json.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()

    global MINED_FILE
    MINED_FILE = Path(args.out)

    if args.mode in ("osm", "both") and not (args.district and args.state):
        print("[harvester] --district and --state are required for --mode=osm or --mode=both.", file=sys.stderr)
        sys.exit(1)

    existing = _load_existing()
    print(f"[harvester] loaded {len(existing)} existing mined landmarks")

    new_records: list[dict] = []

    if args.mode in ("osm", "both"):
        osm_records = overpass_crawler.crawl(
            district=args.district,
            state=args.state,
            existing=existing + new_records,
        )
        new_records.extend(osm_records)
        print(f"[harvester] OSM: +{len(osm_records)} new landmarks")

    if args.mode in ("reddit", "both"):
        reddit_records = reddit_crawler.crawl(
            limit=args.limit,
            existing=existing + new_records,
        )
        new_records.extend(reddit_records)
        print(f"[harvester] Reddit: +{len(reddit_records)} new landmarks")

    if not new_records:
        print("[harvester] no new landmarks discovered. Nothing written.")
        return

    merged = existing + new_records
    _save(merged)
    print(f"[harvester] wrote {len(merged)} total records to {MINED_FILE}")

    inserted = _seed_to_db(new_records)
    if inserted:
        print(f"[harvester] seeded {inserted} new records into target_landmarks")


if __name__ == "__main__":
    main()
