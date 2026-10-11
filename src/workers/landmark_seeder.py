"""
Seeds target_landmarks from curated_landmarks.json into the database.
Run with: python -m src.workers.landmark_seeder --file=data/landmarks/curated_landmarks.json

This seeder is exclusively for manually verified curated landmarks.
mined_landmarks.json is handled by india_harvester, which seeds directly on every run.

Flags:
  --file       Path to the curated JSON file (required).
  --dry-run    Validate and print records without writing to DB.
"""

import argparse
import json
import sys
from pathlib import Path

import psycopg2

from src.config.settings import settings


MINED_FILE = Path("data/landmarks/mined_landmarks.json")

REQUIRED_FIELDS = {"id", "name", "category", "target_description", "latitude", "longitude", "source"}
VALID_CATEGORIES = {"park", "water", "flora", "heritage", "scenic_view", "cafe_exterior"}

_INSERT_SQL = """
    INSERT INTO target_landmarks
        (id, name, category, target_description, location, geofence_radius_meters, source)
    VALUES
        (%(id)s, %(name)s, %(category)s, %(target_description)s,
         ST_SetSRID(ST_Point(%(longitude)s, %(latitude)s), 4326),
         %(geofence_radius_meters)s, %(source)s)
    ON CONFLICT (id) DO NOTHING
"""


def _validate(records: list[dict]) -> list[str]:
    """Returns a list of error strings. Empty list means all records are valid."""
    errors: list[str] = []
    for i, rec in enumerate(records):
        missing = REQUIRED_FIELDS - rec.keys()
        if missing:
            errors.append(f"record[{i}] missing fields: {', '.join(sorted(missing))}")
            continue

        if rec["category"] not in VALID_CATEGORIES:
            errors.append(
                f"record[{i}] '{rec['name']}': invalid category '{rec['category']}'. "
                f"Valid: {', '.join(sorted(VALID_CATEGORIES))}"
            )

        try:
            lat = float(rec["latitude"])
            lon = float(rec["longitude"])
        except (TypeError, ValueError):
            errors.append(f"record[{i}] '{rec['name']}': latitude/longitude must be numeric")
            continue

        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            errors.append(
                f"record[{i}] '{rec['name']}': coordinates out of range "
                f"(lat={lat}, lon={lon})"
            )

        if not rec.get("id") or len(str(rec["id"])) < 10:
            errors.append(f"record[{i}] '{rec['name']}': id is missing or too short")

    return errors


def _seed(records: list[dict]) -> int:
    """Upserts validated records into target_landmarks. Returns count of newly inserted rows."""
    conn = psycopg2.connect(str(settings.database_url), connect_timeout=5)
    inserted = 0
    try:
        with conn.cursor() as cur:
            for rec in records:
                rec.setdefault("geofence_radius_meters", 50.0)
                cur.execute(_INSERT_SQL, rec)
                inserted += cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed landmarks into target_landmarks table (via live API or file)."
    )
    parser.add_argument(
        "--file",
        default="data/landmarks/curated_landmarks.json",
        help="Path to curated_landmarks.json (default: data/landmarks/curated_landmarks.json).",
    )
    parser.add_argument(
        "--source",
        choices=["api", "file"],
        default="file",
        help="Data source: 'api' fetches directly from live Wikidata API, 'file' reads local JSON.",
    )
    parser.add_argument(
        "--state",
        default="West Bengal",
        help="State name when seeding from live API (e.g. 'West Bengal', 'Maharashtra', 'Delhi').",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Max landmarks to fetch from live API (default: 200).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print records without writing to the database.",
    )
    args = parser.parse_args()

    raw: list[dict] = []

    # If --source=api is specified, fetch live data from Wikidata API directly
    if args.source == "api":
        print(f"[seeder] fetching verified cultural landmarks live from Wikidata API for {args.state}...")
        from src.workers import curated_curator
        raw = curated_curator.curate(state=args.state, limit=args.limit)
        print(f"[seeder] fetched {len(raw)} landmarks from Wikidata API.")
    else:
        path = Path(args.file).resolve()
        if path.resolve() == MINED_FILE.resolve():
            print(
                "[seeder] mined_landmarks.json is handled by india_harvester:\n"
                "         python -m src.workers.india_harvester --mode=osm --district=... --state=...",
                file=sys.stderr,
            )
            sys.exit(1)

        if not path.exists():
            print(f"[seeder] file not found: {path}", file=sys.stderr)
            sys.exit(1)

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"[seeder] invalid JSON in {path}: {exc}", file=sys.stderr)
            sys.exit(1)

        if not isinstance(raw, list):
            print(f"[seeder] expected a JSON array, got {type(raw).__name__}", file=sys.stderr)
            sys.exit(1)

        # If file is empty, automatically suggest or fall back to live API
        if not raw:
            print(
                "[seeder] curated_landmarks.json is empty. Fetching live from Wikidata API instead...",
            )
            from src.workers import curated_curator
            raw = curated_curator.curate(state=args.state, limit=args.limit)
            print(f"[seeder] fetched {len(raw)} real landmarks from Wikidata API.")

    errors = _validate(raw)
    if errors:
        print(f"[seeder] {len(errors)} validation error(s) — nothing written:", file=sys.stderr)
        for err in errors:
            print(f"  • {err}", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print(f"[seeder] dry-run: {len(raw)} valid records would be inserted:")
        for rec in raw:
            print(f"  • [{rec['category']}] {rec['name']} ({rec['latitude']}, {rec['longitude']})")
        return

    try:
        inserted = _seed(raw)
    except psycopg2.OperationalError as exc:
        print(f"[seeder] connection failed: {exc}", file=sys.stderr)
        sys.exit(1)
    except psycopg2.DatabaseError as exc:
        print(f"[seeder] insert failed: {exc}", file=sys.stderr)
        sys.exit(1)

    skipped = len(raw) - inserted
    print(f"[seeder] inserted {inserted} records ({skipped} already existed, skipped).")


if __name__ == "__main__":
    main()
