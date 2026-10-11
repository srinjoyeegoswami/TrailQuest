"""
OSRM foot routing client.
Communicates with the local OSRM foot engine (http://localhost:5000/route/v1/foot).
Falls back to geometric interpolation if the OSRM daemon is not running.
"""

import math
from typing import Any
import httpx

from src.config.settings import settings


def _format_coords(waypoints: list[tuple[float, float]]) -> str:
    """Formats list of (lat, lon) into OSRM format: lon1,lat1;lon2,lat2;..."""
    return ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in waypoints)


def _haversine_distance(coord1: tuple[float, float], coord2: tuple[float, float]) -> float:
    """Distance in meters between two (lat, lon) points."""
    R = 6_371_000.0
    lat1, lon1 = math.radians(coord1[0]), math.radians(coord1[1])
    lat2, lon2 = math.radians(coord2[0]), math.radians(coord2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2.0) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2.0) ** 2
    return 2.0 * R * math.asin(math.sqrt(a))


def _generate_fallback_route(waypoints: list[tuple[float, float]]) -> dict[str, Any]:
    """
    Fallback generator when OSRM engine is offline.
    Constructs a segmented route with estimated foot speed (5 min/km = 3.33 m/s).
    """
    coordinates: list[list[float]] = []
    legs: list[dict[str, Any]] = []
    total_dist = 0.0

    for i in range(len(waypoints) - 1):
        start = waypoints[i]
        end = waypoints[i + 1]
        dist = _haversine_distance(start, end)
        total_dist += dist

        # Interpolate 5 intermediate coordinates per leg
        for step in range(5):
            frac = step / 5.0
            lat = start[0] + frac * (end[0] - start[0])
            lon = start[1] + frac * (end[1] - start[1])
            coordinates.append([lon, lat])

        dur = dist / 3.0  # Approx 3 m/s foot pace
        legs.append({
            "distance": dist,
            "duration": dur,
            "steps": [
                {
                    "distance": dist,
                    "duration": dur,
                    "name": f"Waypoint {i+1} Approach",
                    "maneuver": {
                        "type": "depart" if i == 0 else "continue",
                        "modifier": "straight",
                        "location": [start[1], start[0]],
                    },
                }
            ],
        })

    # Append destination point
    coordinates.append([waypoints[-1][1], waypoints[-1][0]])

    return {
        "status": "fallback",
        "total_distance_meters": total_dist,
        "estimated_duration_seconds": total_dist / 3.0,
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "legs": legs,
    }


def query_route(waypoints: list[tuple[float, float]]) -> dict[str, Any]:
    """
    Queries OSRM /route/v1/foot for the given (lat, lon) waypoints.
    Returns structured route data including GeoJSON geometry, distance, duration, and steps.
    """
    if len(waypoints) < 2:
        raise ValueError("At least 2 waypoints are required to compute a route.")

    coords_str = _format_coords(waypoints)
    url = f"{settings.osrm_base_url}/{coords_str}"
    params = {
        "steps": "true",
        "geometries": "geojson",
        "overview": "full",
        "annotations": "true",
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            if data.get("code") != "Ok" or not data.get("routes"):
                print(f"[osrm] Non-OK response code: {data.get('code')}. Using fallback route.")
                return _generate_fallback_route(waypoints)

            primary_route = data["routes"][0]
            return {
                "status": "osrm",
                "total_distance_meters": float(primary_route["distance"]),
                "estimated_duration_seconds": float(primary_route["duration"]),
                "geometry": primary_route["geometry"],
                "legs": primary_route.get("legs", []),
            }

    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        print(f"[osrm] Local foot engine unavailable ({exc}). Using geometric fallback.")
        return _generate_fallback_route(waypoints)
