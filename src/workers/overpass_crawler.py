"""
Overpass API crawler for OSM outdoor landmarks.

Queries the Overpass API for a given Indian district and extracts parks,
water bodies, heritage sites, viewpoints, and flora features.
Results are returned as dicts matching the target_landmarks schema.
"""

import math
import time
import uuid
from typing import Any

import requests

from src.config.settings import settings


# Maps (OSM key, OSM tag value) → TrailQuest category
_TAG_CATEGORY: dict[tuple[str, str], str] = {
    ("leisure", "park"):           "park",
    ("leisure", "garden"):         "park",
    ("leisure", "dog_park"):       "park",
    ("leisure", "nature_reserve"): "flora",
    ("natural", "water"):          "water",
    ("natural", "lake"):           "water",
    ("natural", "pond"):           "water",
    ("natural", "river"):          "water",
    ("natural", "stream"):         "water",
    ("natural", "beach"):          "scenic_view",
    ("natural", "tree"):           "flora",
    ("natural", "wood"):           "flora",
    ("natural", "forest"):         "flora",
    ("natural", "grassland"):      "flora",
    ("natural", "scrub"):          "flora",
    ("historic", "monument"):      "heritage",
    ("historic", "memorial"):      "heritage",
    ("historic", "ruins"):         "heritage",
    ("historic", "temple"):        "heritage",
    ("historic", "fort"):          "heritage",
    ("historic", "ghats"):         "heritage",
    ("tourism", "viewpoint"):      "scenic_view",
    ("tourism", "attraction"):     "scenic_view",
    ("tourism", "artwork"):        "scenic_view",
    ("waterway", "waterfall"):     "scenic_view",
    ("amenity", "fountain"):       "scenic_view",
}

# Default geofence radius per category (meters)
_CATEGORY_RADIUS: dict[str, float] = {
    "park":       60.0,
    "water":      55.0,
    "flora":      50.0,
    "heritage":   55.0,
    "scenic_view": 50.0,
}

_OVERPASS_QUERY = """
[out:json][timeout:{timeout}];
area["name"="{district}"]["boundary"="administrative"]->.district;
area["name"="{state}"]["boundary"="administrative"]->.state;
(
  node["leisure"~"^(park|garden|nature_reserve|dog_park)$"](area.district);
  node["natural"~"^(water|lake|pond|river|stream|beach|tree|wood|forest|grassland|scrub)$"](area.district);
  node["historic"](area.district);
  node["tourism"~"^(viewpoint|attraction|artwork)$"](area.district);
  node["waterway"="waterfall"](area.district);
  node["amenity"="fountain"](area.district);
  way["leisure"~"^(park|garden|nature_reserve)$"](area.district);
  way["natural"~"^(water|lake|wood|forest|beach)$"](area.district);
  way["historic"](area.district);
  relation["leisure"~"^(park|nature_reserve)$"](area.district);
);
out center tags;
"""

# Fallback query when district area lookup returns nothing — searches by bounding box derived from Nominatim
_OVERPASS_BBOX_QUERY = """
[out:json][timeout:{timeout}];
(
  node["leisure"~"^(park|garden|nature_reserve|dog_park)$"]({south},{west},{north},{east});
  node["natural"~"^(water|lake|pond|river|stream|beach|tree|wood|forest|grassland)$"]({south},{west},{north},{east});
  node["historic"]({south},{west},{north},{east});
  node["tourism"~"^(viewpoint|attraction|artwork)$"]({south},{west},{north},{east});
  node["waterway"="waterfall"]({south},{west},{north},{east});
  node["amenity"="fountain"]({south},{west},{north},{east});
  way["leisure"~"^(park|garden|nature_reserve)$"]({south},{west},{north},{east});
  way["natural"~"^(water|lake|wood|forest|beach)$"]({south},{west},{north},{east});
  relation["leisure"~"^(park|nature_reserve)$"]({south},{west},{north},{east});
);
out center tags;
"""


def _resolve_bbox(district: str, state: str) -> tuple[float, float, float, float] | None:
    """Returns (south, west, north, east) bounding box from Nominatim, or None on failure."""
    try:
        resp = requests.get(
            f"{settings.nominatim_url}/search",
            params={"q": f"{district}, {state}, India", "format": "json", "limit": 1},
            headers={"User-Agent": settings.nominatim_user_agent},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
        if not results:
            return None
        bb = results[0].get("boundingbox")
        if not bb or len(bb) < 4:
            return None
        # Nominatim returns [south, north, west, east]
        return float(bb[0]), float(bb[2]), float(bb[1]), float(bb[3])
    except requests.RequestException:
        return None


def _classify_element(tags: dict[str, str]) -> tuple[str, str] | None:
    """
    Returns (category, target_description) for an OSM element, or None if uncategorised.
    Iterates tag priority in _TAG_CATEGORY insertion order.
    """
    for (key, val), category in _TAG_CATEGORY.items():
        if tags.get(key) == val:
            name = tags.get("name", "")
            extra = tags.get("description") or tags.get("wikipedia") or tags.get("note") or ""
            desc = f"{name} — {key}:{val}"
            if extra:
                desc = f"{desc}. {extra[:200]}"
            return category, desc.strip()

    # Catch-all for historic=* with any value
    if "historic" in tags:
        name = tags.get("name", "historic site")
        return "heritage", f"{name} — historic:{tags['historic']}"

    return None


def _extract_coords(element: dict[str, Any]) -> tuple[float, float] | None:
    """Extracts (lat, lon) from a node or a way/relation with a center."""
    etype = element.get("type")
    if etype == "node":
        return element.get("lat"), element.get("lon")
    center = element.get("center")
    if center:
        return center.get("lat"), center.get("lon")
    return None


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 coordinates."""
    R = 6_371_000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _deduplicate(
    incoming: list[dict], existing: list[dict], radius_m: float
) -> list[dict]:
    """
    Drops records from `incoming` that fall within `radius_m` of any record
    in `existing` or of an earlier record in `incoming` (prevents internal dupes).
    """
    accepted: list[dict] = []
    pool = list(existing)

    for rec in incoming:
        lat, lon = rec["latitude"], rec["longitude"]
        duplicate = any(
            haversine_meters(lat, lon, r["latitude"], r["longitude"]) <= radius_m
            for r in pool
        )
        if not duplicate:
            accepted.append(rec)
            pool.append(rec)

    return accepted


def crawl(
    district: str,
    state: str,
    existing: list[dict] | None = None,
) -> list[dict]:
    """
    Fetches outdoor landmarks from Overpass for `district`, `state` (India).
    Deduplicates against `existing` records using settings.dedup_radius_meters.
    Returns a list of new landmark dicts ready for JSON serialisation.
    """
    existing = existing or []

    # Try district-named area query first
    query = _OVERPASS_QUERY.format(
        district=district,
        state=state,
        timeout=settings.overpass_timeout,
    )

    headers = {"User-Agent": "TrailQuest-Harvester/1.0"}

    try:
        resp = requests.post(
            settings.overpass_url,
            data={"data": query},
            headers=headers,
            timeout=settings.overpass_timeout + 10,
        )
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
    except requests.RequestException as exc:
        print(f"[overpass] primary query failed: {exc}")
        elements = []

    # Fall back to bounding box if area query returned nothing
    if not elements:
        print(f"[overpass] area '{district}' not found in OSM — falling back to bbox via Nominatim")
        time.sleep(settings.nominatim_rate_limit_sec)
        bbox = _resolve_bbox(district, state)
        if bbox is None:
            print(f"[overpass] Nominatim could not resolve '{district}, {state}'. No data fetched.")
            return []

        south, west, north, east = bbox
        bbox_query = _OVERPASS_BBOX_QUERY.format(
            south=south, west=west, north=north, east=east,
            timeout=settings.overpass_timeout,
        )
        try:
            resp = requests.post(
                settings.overpass_url,
                data={"data": bbox_query},
                headers=headers,
                timeout=settings.overpass_timeout + 10,
            )
            resp.raise_for_status()
            elements = resp.json().get("elements", [])
        except requests.RequestException as exc:
            print(f"[overpass] bbox query failed: {exc}")
            return []

    landmarks: list[dict] = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name", "").strip()
        if not name:
            continue

        coords = _extract_coords(el)
        if not coords or None in coords:
            continue
        lat, lon = coords

        result = _classify_element(tags)
        if result is None:
            continue
        category, description = result

        landmarks.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "locality": tags.get("addr:suburb") or tags.get("addr:city") or "",
            "city": tags.get("addr:city") or district,
            "state": state,
            "category": category,
            "target_description": description,
            "latitude": lat,
            "longitude": lon,
            "geofence_radius_meters": _CATEGORY_RADIUS.get(category, 50.0),
            "source": "mined_osm",
        })

    deduped = _deduplicate(landmarks, existing, settings.dedup_radius_meters)
    print(f"[overpass] {len(elements)} elements → {len(landmarks)} named → {len(deduped)} after dedup")
    return deduped
