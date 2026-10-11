"""
Sync API Controller.
Exposes POST /api/v1/sync/run-payload for ingesting completed runs,
evaluating route adherence via PostGIS, validating quest submissions via Gemma,
and calculating rewards.
"""

from datetime import datetime
import json
from typing import Any
import uuid
from fastapi import APIRouter
from pydantic import BaseModel, Field
import psycopg2

from src.config.settings import settings
from src.services.gis import trajectory, geofence
from src.agent.tools import evaluation_tools

router = APIRouter(prefix="/api/v1/sync", tags=["Sync"])


class TelemetryPoint(BaseModel):
    latitude: float
    longitude: float
    timestamp: str
    speed: float = 0.0


class RunData(BaseModel):
    start_time: str
    end_time: str
    mode: str = "running"
    telemetry_points: list[TelemetryPoint] = Field(default_factory=list)


class QuestSubmissionItem(BaseModel):
    quest_type: str  # "visual" or "social"
    image_base64_or_path: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    self_reported_count: int = 0
    timestamp: str | None = None


class SyncRunPayloadRequest(BaseModel):
    user_id: str
    planned_route_id: str | None = None
    run: RunData
    quest_submissions: list[QuestSubmissionItem] = Field(default_factory=list)


class SubmissionEvaluationResult(BaseModel):
    quest_type: str
    matched_landmark_name: str | None = None
    is_verified: bool
    points_awarded: int
    agent_narrative: str


class SyncRunPayloadResponse(BaseModel):
    run_id: str
    user_id: str
    status: str
    total_distance_km: float
    average_pace_min_km: float
    is_route_adherent: bool
    deviation_meters: float
    quest_evaluations: list[SubmissionEvaluationResult]
    total_points_awarded: int
    score_breakdown: dict[str, Any]


def _persist_run_initial(
    run_id: str,
    user_id: str,
    planned_route_id: str | None,
    run: RunData,
    line_geojson: dict[str, Any],
    dist_km: float,
    pace: float,
) -> None:
    try:
        conn = psycopg2.connect(str(settings.database_url), connect_timeout=3)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id, username) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING;",
                (user_id, f"runner_{user_id[:8]}"),
            )
            cur.execute(
                """
                INSERT INTO runs
                    (id, user_id, planned_route_id, start_time, end_time, mode,
                     total_distance_km, average_pace_min_km, route_path, status)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s,
                     ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 'pending_evaluation')
                ON CONFLICT (id) DO NOTHING;
                """,
                (run_id, user_id, planned_route_id, run.start_time, run.end_time, run.mode,
                 dist_km, pace, json.dumps(line_geojson)),
            )
        conn.commit()
        conn.close()
    except Exception as exc:
        print(f"[sync_controller] DB persist run initial note: {exc}")


@router.post("/run-payload", response_model=SyncRunPayloadResponse)
def sync_run_payload(payload: SyncRunPayloadRequest) -> SyncRunPayloadResponse:
    """Ingests offline runs, triggers Hermes agent evaluation, and tallies rewards."""
    run_id = str(uuid.uuid4())

    # 1. Reconstruct telemetry LineString
    telemetry_dicts = [p.model_dump() for p in payload.run.telemetry_points]
    traj = trajectory.reconstruct_trajectory(
        telemetry_dicts,
        start_time=payload.run.start_time,
        end_time=payload.run.end_time,
    )

    # 2. Persist initial run state
    _persist_run_initial(
        run_id=run_id,
        user_id=payload.user_id,
        planned_route_id=payload.planned_route_id,
        run=payload.run,
        line_geojson=traj["geometry"],
        dist_km=traj["total_distance_km"],
        pace=traj["average_pace_min_km"],
    )

    # 3. Hermes Evaluation Tool 1: Navigation accuracy
    planned_coords = None
    if payload.planned_route_id:
        try:
            conn = psycopg2.connect(str(settings.database_url), connect_timeout=3)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT ST_AsGeoJSON(route_geometry) FROM planned_routes WHERE id = %s;",
                    (payload.planned_route_id,),
                )
                row = cur.fetchone()
                if row and row[0]:
                    planned_coords = json.loads(row[0]).get("coordinates")
            conn.close()
        except Exception:
            pass

    nav_eval = evaluation_tools.evaluate_run_navigation_accuracy(
        planned_route_id=payload.planned_route_id or "",
        run_id=run_id,
        planned_coords=planned_coords,
        actual_coords=traj["geometry"]["coordinates"],
    )

    # 4. Hermes Evaluation Tool 2: Visual & social quest submissions
    quest_results: list[SubmissionEvaluationResult] = []
    verified_landmarks = 0
    social_greetings = 0

    for sub in payload.quest_submissions:
        if sub.quest_type == "visual":
            lat = sub.latitude or 0.0
            lon = sub.longitude or 0.0
            matched_lm = geofence.find_matching_landmark(lat, lon)

            if matched_lm:
                lm_name = matched_lm["name"]
                lm_desc = matched_lm.get("target_description", "landmark")

                vision_eval = evaluation_tools.run_gemma_vision_verifier(
                    image_path=sub.image_base64_or_path or "",
                    landmark_target_description=lm_desc,
                )

                pts = 150 if payload.run.mode == "running" else 100
                if vision_eval["verified"]:
                    verified_landmarks += 1

                quest_results.append(
                    SubmissionEvaluationResult(
                        quest_type="visual",
                        matched_landmark_name=lm_name,
                        is_verified=vision_eval["verified"],
                        points_awarded=pts if vision_eval["verified"] else 0,
                        agent_narrative=vision_eval["narrative"],
                    )
                )
            else:
                quest_results.append(
                    SubmissionEvaluationResult(
                        quest_type="visual",
                        matched_landmark_name=None,
                        is_verified=False,
                        points_awarded=0,
                        agent_narrative="Photo was taken outside of any registered landmark geofence.",
                    )
                )

        elif sub.quest_type == "social":
            count = max(0, sub.self_reported_count)
            social_greetings += count
            pts = count * 15
            quest_results.append(
                SubmissionEvaluationResult(
                    quest_type="social",
                    matched_landmark_name=None,
                    is_verified=True,
                    points_awarded=pts,
                    agent_narrative=f"Validated {count} runner greeting(s) (+{pts} pts).",
                )
            )

    # 5. Hermes Evaluation Tool 3: Score & badge tallying
    score_res = evaluation_tools.tally_quest_score(
        run_id=run_id,
        user_id=payload.user_id,
        mode=payload.run.mode,
        total_distance_km=traj["total_distance_km"],
        is_route_adherent=nav_eval["is_route_adherent"],
        verified_landmarks_count=verified_landmarks,
        social_interactions_count=social_greetings,
    )

    return SyncRunPayloadResponse(
        run_id=run_id,
        user_id=payload.user_id,
        status="processed",
        total_distance_km=traj["total_distance_km"],
        average_pace_min_km=traj["average_pace_min_km"],
        is_route_adherent=nav_eval["is_route_adherent"],
        deviation_meters=nav_eval["deviation_meters"],
        quest_evaluations=quest_results,
        total_points_awarded=score_res["total_points"],
        score_breakdown=score_res["breakdown"],
    )
