"""
Curated landmark curator — populates curated_landmarks.json via Wikidata SPARQL.

Fetches Wikipedia-verified Indian heritage sites, temples, forts, ghats, parks,
and nature reserves directly from the Wikidata knowledge graph.
Only items with an English Wikipedia article are accepted (quality gate).

Run with:
  python -m src.workers.curated_curator                            # all India
  python -m src.workers.curated_curator --state="West Bengal"     # state-filtered
  python -m src.workers.curated_curator --state="Maharashtra" --district="Pune"
  python -m src.workers.curated_curator --dry-run --state="Kerala"
"""

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

import requests

from src.config.settings import settings
from src.workers.overpass_crawler import haversine_meters

CURATED_FILE = Path("data/landmarks/curated_landmarks.json")

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

# Approximate bounding boxes (south, west, north, east) for Indian states.
# Used to spatially filter Wikidata results when --state is provided.
_STATE_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "andhra pradesh":      (12.41, 76.76, 19.92, 84.76),
    "arunachal pradesh":   (26.63, 91.50, 29.47, 97.40),
    "assam":               (24.10, 89.70, 27.98, 96.02),
    "bihar":               (24.29, 83.33, 27.52, 88.30),
    "chhattisgarh":        (17.77, 80.24, 24.11, 84.40),
    "goa":                 (14.89, 73.65, 15.80, 74.32),
    "gujarat":             (20.07, 68.16, 24.71, 74.47),
    "haryana":             (27.65, 74.46, 30.91, 77.61),
    "himachal pradesh":    (30.38, 75.57, 33.25, 79.04),
    "jharkhand":           (21.97, 83.33, 25.36, 87.97),
    "karnataka":           (11.59, 74.05, 18.45, 78.57),
    "kerala":              ( 8.29, 74.86, 12.78, 77.42),
    "madhya pradesh":      (21.08, 74.02, 26.87, 82.81),
    "maharashtra":         (15.61, 72.66, 22.03, 80.89),
    "manipur":             (23.84, 92.94, 25.69, 94.78),
    "meghalaya":           (25.02, 89.81, 26.11, 92.80),
    "mizoram":             (21.96, 92.26, 24.52, 93.44),
    "nagaland":            (25.17, 93.34, 27.04, 95.25),
    "odisha":              (17.78, 81.29, 22.57, 87.50),
    "punjab":              (29.54, 73.87, 32.50, 76.93),
    "rajasthan":           (23.06, 69.47, 30.19, 78.27),
    "sikkim":              (27.09, 88.01, 28.13, 88.91),
    "tamil nadu":          ( 8.07, 76.23, 13.58, 80.35),
    "telangana":           (15.79, 77.21, 19.92, 81.33),
    "tripura":             (22.94, 91.17, 24.54, 92.34),
    "uttar pradesh":       (23.87, 77.09, 30.43, 84.63),
    "uttarakhand":         (28.72, 77.57, 31.45, 81.03),
    "west bengal":         (21.63, 85.83, 27.21, 89.89),
    "delhi":               (28.40, 76.84, 28.88, 77.35),
    "jammu and kashmir":   (32.26, 73.75, 36.00, 80.32),
    "ladakh":              (32.17, 75.56, 36.00, 80.32),
    "andaman and nicobar": ( 6.74, 92.20, 13.68, 93.95),
    "lakshadweep":         ( 8.00, 71.80, 12.60, 74.10),
    "chandigarh":          (30.66, 76.68, 30.80, 76.87),
    "puducherry":          (11.65, 79.72, 12.07, 79.91),
}

# Wikidata type QIDs → TrailQuest category
_TYPE_CATEGORY: dict[str, str] = {
    "Q44377":    "heritage",   # fort
    "Q23413":    "heritage",   # castle
    "Q839954":   "heritage",   # archaeological site
    "Q16744108": "heritage",   # Hindu temple
    "Q16970":    "heritage",   # church
    "Q1060829":  "heritage",   # mosque
    "Q1321864":  "heritage",   # palace
    "Q12280":    "heritage",   # bridge (historic)
    "Q166118":   "heritage",   # ghat
    "Q82117":    "heritage",   # lighthouse
    "Q207694":   "scenic_view",# art museum
    "Q33506":    "scenic_view",# museum
    "Q6138682":  "flora",      # national park
    "Q179049":   "flora",      # wildlife sanctuary
    "Q1973417":  "flora",      # biosphere reserve
    "Q22698":    "park",       # park
    "Q2087056":  "water",      # reservoir
    "Q23397":    "water",      # lake
    "Q4022":     "water",      # river
}

# Default geofence per category
_CATEGORY_RADIUS: dict[str, float] = {
    "heritage":   60.0,
    "scenic_view": 55.0,
    "flora":      80.0,
    "park":       65.0,
    "water":      60.0,
}

# Wikidata SPARQL query — fetches Indian landmarks with Wikipedia article gate
_SPARQL_QUERY = """
SELECT DISTINCT ?item ?name ?lat ?lon ?typeQid ?desc WHERE {{
  VALUES ?type {{
    wd:Q44377 wd:Q23413 wd:Q839954 wd:Q16744108 wd:Q16970
    wd:Q1060829 wd:Q1321864 wd:Q12280 wd:Q166118 wd:Q82117
    wd:Q207694 wd:Q33506 wd:Q6138682 wd:Q179049 wd:Q1973417
    wd:Q22698 wd:Q2087056 wd:Q23397
  }}
  ?item wdt:P17 wd:Q668 ;
        wdt:P31/wdt:P279* ?type ;
        wdt:P625 ?coords ;
        rdfs:label ?name .
  FILTER(LANG(?name) = "en")
  FILTER EXISTS {{
    ?article schema:about ?item ;
             schema:inLanguage "en" .
  }}
  OPTIONAL {{
    ?item schema:description ?desc .
    FILTER(LANG(?desc) = "en")
  }}
  BIND(geof:latitude(?coords) AS ?lat)
  BIND(geof:longitude(?coords) AS ?lon)
  BIND(STRAFTER(STR(?type), "http://www.wikidata.org/entity/") AS ?typeQid)
}}
ORDER BY ?name
LIMIT {limit}
"""


def _fetch_wikidata(limit: int) -> list[dict]:
    query = _SPARQL_QUERY.format(limit=limit)
    try:
        resp = requests.get(
            WIKIDATA_SPARQL,
            params={"query": query, "format": "json"},
            headers={"User-Agent": settings.nominatim_user_agent},
            timeout=60,
        )
        resp.raise_for_status()
        bindings = resp.json()["results"]["bindings"]
        return bindings
    except (requests.RequestException, KeyError) as exc:
        print(f"[curator] Wikidata query failed: {exc}", file=sys.stderr)
        return []


def _resolve_district_bbox(district: str, state: str) -> tuple[float, float, float, float] | None:
    """Resolves district to bbox via Nominatim for sub-state filtering."""
    time.sleep(settings.nominatim_rate_limit_sec)
    query = f"{district}, {state}, India"
    try:
        resp = requests.get(
            f"{settings.nominatim_url}/search",
            params={"q": query, "format": "json", "limit": 1, "countrycodes": "in"},
            headers={"User-Agent": settings.nominatim_user_agent},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
        if not results:
            return None
        bb = results[0].get("boundingbox", [])
        if len(bb) < 4:
            return None
        return float(bb[0]), float(bb[2]), float(bb[1]), float(bb[3])
    except (requests.RequestException, ValueError):
        return None


def _in_bbox(lat: float, lon: float, bbox: tuple[float, float, float, float]) -> bool:
    south, west, north, east = bbox
    return south <= lat <= north and west <= lon <= east


def _deduplicate(incoming: list[dict], existing: list[dict], radius_m: float) -> list[dict]:
    accepted: list[dict] = []
    pool = list(existing)
    for rec in incoming:
        lat, lon = rec["latitude"], rec["longitude"]
        if any(
            haversine_meters(lat, lon, r["latitude"], r["longitude"]) <= radius_m
            for r in pool
        ):
            continue
        accepted.append(rec)
        pool.append(rec)
    return accepted


def _parse_binding(b: dict) -> dict | None:
    """Converts a Wikidata SPARQL binding row into a landmark dict."""
    try:
        lat = float(b["lat"]["value"])
        lon = float(b["lon"]["value"])
    except (KeyError, ValueError):
        return None

    name = b.get("name", {}).get("value", "").strip()
    if not name:
        return None

    type_qid = b.get("typeQid", {}).get("value", "")
    category = _TYPE_CATEGORY.get(type_qid, "scenic_view")

    desc = b.get("desc", {}).get("value", "").strip()
    if not desc:
        desc = f"{name} — verified cultural landmark in India"

    item_url = b.get("item", {}).get("value", "")
    wikidata_id = item_url.split("/")[-1] if item_url else str(uuid.uuid4())

    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, item_url or name)),
        "name": name,
        "locality": "",
        "city": "",
        "state": "",
        "category": category,
        "target_description": desc[:300],
        "latitude": lat,
        "longitude": lon,
        "geofence_radius_meters": _CATEGORY_RADIUS.get(category, 55.0),
        "source": "curated",
        "wikidata_id": wikidata_id,
    }


def curate(
    state: str = "",
    district: str = "",
    limit: int = 2000,
) -> list[dict]:
    """
    Fetches verified Indian landmarks from Wikidata.
    Filters spatially by state and optionally district.
    Returns list of landmark dicts.
    """
    print(f"[curator] querying Wikidata SPARQL (limit={limit})...")
    bindings = _fetch_wikidata(limit)
    print(f"[curator] {len(bindings)} raw results from Wikidata")

    bbox: tuple[float, float, float, float] | None = None

    if state:
        state_key = state.strip().lower()
        bbox = _STATE_BBOXES.get(state_key)
        if bbox is None:
            print(f"[curator] state '{state}' not in bbox table — fetching from Nominatim")
            time.sleep(settings.nominatim_rate_limit_sec)
            bbox = _resolve_district_bbox(state, "India")
        if bbox:
            print(f"[curator] filtering to state '{state}' bbox: {bbox}")

    if district and state:
        district_bbox = _resolve_district_bbox(district, state)
        if district_bbox:
            bbox = district_bbox
            print(f"[curator] narrowed to district '{district}' bbox: {bbox}")

    landmarks: list[dict] = []
    for b in bindings:
        rec = _parse_binding(b)
        if rec is None:
            continue
        if bbox and not _in_bbox(rec["latitude"], rec["longitude"], bbox):
            continue
        landmarks.append(rec)

    print(f"[curator] {len(landmarks)} landmarks after spatial filter")
    return landmarks


def _load_existing() -> list[dict]:
    if not CURATED_FILE.exists():
        return []
    try:
        data = json.loads(CURATED_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save(records: list[dict]) -> None:
    CURATED_FILE.parent.mkdir(parents=True, exist_ok=True)
    CURATED_FILE.write_text(
        json.dumps(records, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Populate curated_landmarks.json from Wikidata SPARQL."
    )
    parser.add_argument("--state",    default="", help="Indian state to filter results.")
    parser.add_argument("--district", default="", help="District for sub-state filtering (requires --state).")
    parser.add_argument("--limit",    type=int, default=2000, help="Max Wikidata results to fetch.")
    parser.add_argument("--replace",  action="store_true", help="Overwrite existing file instead of appending.")
    parser.add_argument("--dry-run",  action="store_true", help="Print results without writing to disk.")
    args = parser.parse_args()

    if args.district and not args.state:
        print("[curator] --district requires --state to be set.", file=sys.stderr)
        sys.exit(1)

    existing = [] if args.replace else _load_existing()
    fetched = curate(state=args.state, district=args.district, limit=args.limit)

    if not fetched:
        print("[curator] no landmarks returned. Check Wikidata connectivity.")
        sys.exit(1)

    new_records = _deduplicate(fetched, existing, settings.dedup_radius_meters)
    print(f"[curator] {len(new_records)} new after dedup against {len(existing)} existing")

    if args.dry_run:
        print(f"[curator] dry-run — {len(new_records)} records would be written:")
        for r in new_records[:20]:
            print(f"  • [{r['category']}] {r['name']} ({r['latitude']:.4f}, {r['longitude']:.4f})")
        if len(new_records) > 20:
            print(f"  ... and {len(new_records) - 20} more")
        return

    merged = existing + new_records
    _save(merged)
    print(f"[curator] wrote {len(merged)} total records to {CURATED_FILE}")
    print(f"[curator] run landmark_seeder to push these to the database:")
    print(f"          python -m src.workers.landmark_seeder --file={CURATED_FILE}")


if __name__ == "__main__":
    main()
