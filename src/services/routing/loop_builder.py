"""
Closed-loop route builder.
Selects candidate landmarks around the runner's origin point,
orders them radially to prevent zigzagging, and compiles a closed-loop route.
"""

import json
import math
from pathlib import Path
from typing import Any
import psycopg2
import psycopg2.extras

from src.config.settings import settings
from src.services.routing import osrm_client

CURATED_FILE = Path("data/landmarks/curated_landmarks.json")
MINED_FILE = Path("data/landmarks/mined_landmarks.json")


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * R * math.asin(math.sqrt(a))


def _fetch_db_landmarks(
    origin: tuple[float, float],
    radius_meters: float,
    categories: list[str],
) -> list[dict[str, Any]]:
    """Fetches landmarks from target_landmarks within search radius matching categories."""
    try:
        conn = psycopg2.connect(str(settings.database_url), connect_timeout=3)
    except psycopg2.OperationalError:
        return []

    lat, lon = origin
    sql = """
        SELECT id, name, category, target_description,
               ST_Y(location) AS latitude, ST_X(location) AS longitude,
               geofence_radius_meters,
               ST_Distance(location::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography) AS distance_meters
        FROM target_landmarks
        WHERE (%s::text[] IS NULL OR category = ANY(%s))
          AND ST_DWithin(location::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography, %s)
        ORDER BY distance_meters ASC
        LIMIT 30;
    """
    records = []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(sql, (lon, lat, categories, categories, lon, lat, radius_meters))
            for row in cur.fetchall():
                records.append(dict(row))
    except Exception as exc:
        print(f"[loop_builder] DB query error: {exc}")
    finally:
        conn.close()

    return records


def _fetch_file_landmarks(
    origin: tuple[float, float],
    radius_meters: float,
    categories: list[str],
) -> list[dict[str, Any]]:
    """Fallback reader from curated and mined landmark files."""
    candidates: list[dict[str, Any]] = []
    for filepath in (CURATED_FILE, MINED_FILE):
        if not filepath.exists():
            continue
        try:
            items = json.loads(filepath.read_text(encoding="utf-8"))
            if isinstance(items, list):
                candidates.extend(items)
        except Exception:
            continue

    matched: list[dict[str, Any]] = []
    cat_set = set(categories) if categories else None

    for item in candidates:
        if cat_set and item.get("category") not in cat_set:
            continue
        try:
            lat = float(item["latitude"])
            lon = float(item["longitude"])
        except (KeyError, ValueError, TypeError):
            continue

        dist = _haversine_meters(origin[0], origin[1], lat, lon)
        if dist <= radius_meters:
            rec = dict(item)
            rec["distance_meters"] = dist
            matched.append(rec)

    matched.sort(key=lambda x: x["distance_meters"])
    return matched


def _generate_synthetic_loop_points(
    origin: tuple[float, float],
    target_dist_m: float,
) -> list[dict[str, Any]]:
    """
    Generates dynamic circular exploration points if no registered landmarks are near origin.
    Creates 3 evenly spaced waypoints on a circle with circumference ~= target_dist_m.
    """
    radius_m = target_dist_m / (2.0 * math.pi)
    lat_deg_per_meter = 1.0 / 111_000.0
    lon_deg_per_meter = 1.0 / (111_000.0 * math.cos(math.radians(origin[0])))

    points = []
    angles = [math.pi / 4.0, math.pi * 3.0 / 4.0, math.pi * 5.0 / 4.0]
    names = ["Scenic Waypoint Alpha", "Scenic Waypoint Beta", "Scenic Waypoint Gamma"]

    for i, angle in enumerate(angles):
        d_lat = (radius_m * math.sin(angle)) * lat_deg_per_meter
        d_lon = (radius_m * math.cos(angle)) * lon_deg_per_meter
        points.append({
            "id": f"syn-waypoint-{i+1}",
            "name": names[i],
            "category": "scenic_view",
            "target_description": f"Expedition checkpoint {i+1} on dynamic running loop",
            "latitude": origin[0] + d_lat,
            "longitude": origin[1] + d_lon,
            "geofence_radius_meters": 50.0,
        })
    return points


def plan_loop(
    origin: tuple[float, float],
    max_distance_km: float,
    desired_categories: list[str] | None = None,
) -> dict[str, Any]:
    """
    Plans a closed-loop quest run starting and ending at origin.
    Returns route geometry, total distance, duration, and ordered landmarks.
    """
    categories = desired_categories or []
    target_distance_m = max_distance_km * 1000.0
    # Search radius is roughly 1/3 of the total perimeter
    search_radius_m = max(500.0, target_distance_m / 3.0)

    # 1. Fetch candidate landmarks (DB first, then local files)
    candidates = _fetch_db_landmarks(origin, search_radius_m, categories)
    if not candidates:
        candidates = _fetch_file_landmarks(origin, search_radius_m, categories)

    # 2. Select landmarks around origin in radial order to form a convex loop
    selected_landmarks: list[dict[str, Any]] = []

    if len(candidates) >= 2:
        # Calculate angle of each landmark relative to origin
        for c in candidates:
            c["angle"] = math.atan2(
                c["latitude"] - origin[0],
                c["longitude"] - origin[1],
            )
        # Sort by polar angle
        candidates.sort(key=lambda x: x["angle"])
        # Pick 2-3 landmarks with greatest angular spread
        selected_landmarks = candidates[:min(3, len(candidates))]
    else:
        # Fallback to dynamic synthetic exploration loop
        selected_landmarks = _generate_synthetic_loop_points(origin, target_distance_m)

    # 3. Assemble closed-loop waypoints: origin -> landmarks -> origin
    waypoints: list[tuple[float, float]] = [origin]
    for lm in selected_landmarks:
        waypoints.append((lm["latitude"], lm["longitude"]))
    waypoints.append(origin)

    # 4. Route through OSRM
    route_data = osrm_client.query_route(waypoints)

    return {
        "origin": {"latitude": origin[0], "longitude": origin[1]},
        "target_distance_km": max_distance_km,
        "total_distance_meters": route_data["total_distance_meters"],
        "estimated_duration_seconds": route_data["estimated_duration_seconds"],
        "route_geometry": route_data["geometry"],
        "legs": route_data["legs"],
        "landmarks": selected_landmarks,
    }
