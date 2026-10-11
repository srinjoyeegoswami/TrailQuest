"""
Routes API Controller.
Exposes POST /api/v1/routes/plan-quest-run for generating closed-loop quest runs
with compiled turn-by-turn spoken audio prompts.
"""

import json
import uuid
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import psycopg2

from src.config.settings import settings
from src.services.routing import loop_builder, audio_compiler

router = APIRouter(prefix="/api/v1/routes", tags=["Routes"])


class Coordinates(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


class PlanRouteRequest(BaseModel):
    user_id: str
    origin: Coordinates
    max_distance_km: float = Field(..., gt=0.5, le=50.0)
    desired_categories: list[str] = Field(default_factory=lambda: ["park", "flora", "scenic_view"])
    persona: str = Field(default="friendly_savage")


class ManeuverResponse(BaseModel):
    sequence_order: int
    maneuver_type: str
    street_name: str
    distance_to_next_meters: float
    audio_prompt_text: str
    estimated_tts_duration_seconds: float
    duck_trigger: str


class PlanRouteResponse(BaseModel):
    id: str
    user_id: str
    start_location: Coordinates
    end_location: Coordinates
    total_distance_meters: float
    estimated_duration_seconds: float
    route_geometry: dict[str, Any]
    maneuvers: list[ManeuverResponse]


def _persist_route(
    route_id: str,
    user_id: str,
    origin: Coordinates,
    total_dist: float,
    duration: float,
    geometry: dict[str, Any],
    maneuvers: list[dict[str, Any]],
) -> None:
    """Stores planned route and maneuvers in PostGIS database if DB is reachable."""
    try:
        conn = psycopg2.connect(str(settings.database_url), connect_timeout=3)
    except psycopg2.OperationalError:
        print("[routes_controller] PostgreSQL unavailable — route returned without DB persistence.")
        return

    try:
        with conn.cursor() as cur:
            # 1. Ensure user exists
            cur.execute(
                "INSERT INTO users (id, username) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING;",
                (user_id, f"runner_{user_id[:8]}"),
            )

            # 2. Insert planned_route
            geom_geojson = json.dumps(geometry)
            cur.execute(
                """
                INSERT INTO planned_routes
                    (id, user_id, start_location, end_location, total_distance_meters, estimated_duration_seconds, route_geometry)
                VALUES
                    (%s, %s,
                     ST_SetSRID(ST_Point(%s, %s), 4326),
                     ST_SetSRID(ST_Point(%s, %s), 4326),
                     %s, %s,
                     ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326));
                """,
                (route_id, user_id, origin.longitude, origin.latitude, origin.longitude, origin.latitude,
                 total_dist, duration, geom_geojson),
            )

            # 3. Insert route_maneuvers
            for m in maneuvers:
                loc = m["maneuver_location"]
                cur.execute(
                    """
                    INSERT INTO route_maneuvers
                        (id, route_id, sequence_order, maneuver_location, maneuver_type, street_name,
                         distance_to_next_meters, audio_prompt_text, estimated_tts_duration_seconds, duck_trigger)
                    VALUES
                        (%s, %s, %s,
                         ST_SetSRID(ST_Point(%s, %s), 4326),
                         %s, %s, %s, %s, %s, %s);
                    """,
                    (str(uuid.uuid4()), route_id, m["sequence_order"],
                     loc.get("longitude", origin.longitude), loc.get("latitude", origin.latitude),
                     m["maneuver_type"], m["street_name"], m["distance_to_next_meters"],
                     m["audio_prompt_text"], m["estimated_tts_duration_seconds"], m["duck_trigger"]),
                )
        conn.commit()
    except Exception as exc:
        print(f"[routes_controller] DB persistence failed: {exc}")
    finally:
        conn.close()


@router.post("/plan-quest-run", response_model=PlanRouteResponse)
def plan_quest_run(payload: PlanRouteRequest) -> PlanRouteResponse:
    """Generates a closed-loop quest run with compiled audio prompts."""
    origin_tuple = (payload.origin.latitude, payload.origin.longitude)

    # 1. Plan closed loop route through landmarks
    route_plan = loop_builder.plan_loop(
        origin=origin_tuple,
        max_distance_km=payload.max_distance_km,
        desired_categories=payload.desired_categories,
    )

    # 2. Compile spoken maneuvers and audio prompts
    maneuvers = audio_compiler.compile_maneuvers(
        route_data=route_plan,
        persona_name=payload.persona,
    )

    route_id = str(uuid.uuid4())

    # 3. Persist in database
    _persist_route(
        route_id=route_id,
        user_id=payload.user_id,
        origin=payload.origin,
        total_dist=route_plan["total_distance_meters"],
        duration=route_plan["estimated_duration_seconds"],
        geometry=route_plan["route_geometry"],
        maneuvers=maneuvers,
    )

    return PlanRouteResponse(
        id=route_id,
        user_id=payload.user_id,
        start_location=payload.origin,
        end_location=payload.origin,
        total_distance_meters=route_plan["total_distance_meters"],
        estimated_duration_seconds=route_plan["estimated_duration_seconds"],
        route_geometry=route_plan["route_geometry"],
        maneuvers=[
            ManeuverResponse(
                sequence_order=m["sequence_order"],
                maneuver_type=m["maneuver_type"],
                street_name=m["street_name"],
                distance_to_next_meters=m["distance_to_next_meters"],
                audio_prompt_text=m["audio_prompt_text"],
                estimated_tts_duration_seconds=m["estimated_tts_duration_seconds"],
                duck_trigger=m["duck_trigger"],
            )
            for m in maneuvers
        ],
    )
