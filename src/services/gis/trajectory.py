"""
GIS Trajectory Processor.
Reconstructs LineString geometries from GPS telemetry breadcrumbs
and computes spatial metrics (distance, duration, average pace).
"""

from datetime import datetime
import math
from typing import Any


def _haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * R * math.asin(math.sqrt(a))


def reconstruct_trajectory(
    telemetry_points: list[dict[str, Any]],
    start_time: str | None = None,
    end_time: str | None = None,
) -> dict[str, Any]:
    """
    Transforms telemetry breadcrumbs into a LineString geometry and computes distance & pace.
    Returns:
      - geometry: GeoJSON LineString dict
      - total_distance_km: float
      - duration_seconds: float
      - average_pace_min_km: float
    """
    if not telemetry_points:
        return {
            "geometry": {"type": "LineString", "coordinates": []},
            "total_distance_km": 0.0,
            "duration_seconds": 0.0,
            "average_pace_min_km": 0.0,
        }

    coordinates: list[list[float]] = []
    total_dist_m = 0.0

    for i, pt in enumerate(telemetry_points):
        lat = float(pt["latitude"])
        lon = float(pt["longitude"])
        coordinates.append([lon, lat])

        if i > 0:
            prev_lat = float(telemetry_points[i - 1]["latitude"])
            prev_lon = float(telemetry_points[i - 1]["longitude"])
            total_dist_m += _haversine_distance_meters(prev_lat, prev_lon, lat, lon)

    # Calculate duration
    duration_sec = 0.0
    if start_time and end_time:
        try:
            t0 = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            duration_sec = max(1.0, (t1 - t0).total_seconds())
        except Exception:
            duration_sec = len(telemetry_points) * 5.0
    else:
        duration_sec = len(telemetry_points) * 5.0

    total_km = max(0.001, total_dist_m / 1000.0)
    pace_min_km = (duration_sec / 60.0) / total_km

    return {
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "total_distance_km": round(total_km, 3),
        "duration_seconds": round(duration_sec, 1),
        "average_pace_min_km": round(pace_min_km, 2),
    }
