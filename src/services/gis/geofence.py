"""
Geofence matching service.
Verifies whether a runner's visual quest submission location falls inside
the geofence radius of a target landmark.
"""

import json
import math
from pathlib import Path
from typing import Any
import psycopg2
import psycopg2.extras

from src.config.settings import settings

CURATED_FILE = Path("data/landmarks/curated_landmarks.json")
MINED_FILE = Path("data/landmarks/mined_landmarks.json")


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * R * math.asin(math.sqrt(a))


def find_matching_landmark(
    latitude: float,
    longitude: float,
) -> dict[str, Any] | None:
    """
    Checks if (latitude, longitude) is within the geofence of any target landmark.
    Returns matched landmark dict or None.
    """
    # 1. PostGIS query
    try:
        conn = psycopg2.connect(str(settings.database_url), connect_timeout=3)
        sql = """
            SELECT id, name, category, target_description, geofence_radius_meters,
                   ST_Distance(location::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography) AS distance_meters
            FROM target_landmarks
            WHERE ST_DWithin(location::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography, geofence_radius_meters)
            ORDER BY distance_meters ASC
            LIMIT 1;
        """
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(sql, (longitude, latitude, longitude, latitude))
            row = cur.fetchone()
            if row:
                return dict(row)
        conn.close()
    except Exception:
        pass

    # 2. Fallback check against local landmark files
    for filepath in (CURATED_FILE, MINED_FILE):
        if not filepath.exists():
            continue
        try:
            records = json.loads(filepath.read_text(encoding="utf-8"))
            for rec in records:
                try:
                    lat = float(rec["latitude"])
                    lon = float(rec["longitude"])
                    radius = float(rec.get("geofence_radius_meters", 50.0))
                except (KeyError, ValueError, TypeError):
                    continue

                dist = _haversine_meters(latitude, longitude, lat, lon)
                if dist <= radius:
                    rec_copy = dict(rec)
                    rec_copy["distance_meters"] = dist
                    return rec_copy
        except Exception:
            continue

    return None
