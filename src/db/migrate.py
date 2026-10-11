"""
Full schema migration for TrailQuest.
Run with: python -m src.db.migrate

Idempotent — safe to run multiple times. Uses IF NOT EXISTS throughout.
Spatial indexes are GIST. All geometry columns use SRID 4326 (WGS84).
Hausdorff distance queries reproject to SRID 3857 (metric) at query time.
"""

import sys
import psycopg2
from psycopg2.extensions import connection as PsycopgConnection

from src.config.settings import settings


DDL = [
    "CREATE EXTENSION IF NOT EXISTS postgis",
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',

    """
    CREATE TABLE IF NOT EXISTS users (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username        VARCHAR(64) UNIQUE NOT NULL,
        total_points    INTEGER DEFAULT 0,
        created_at      TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    """
    CREATE TABLE IF NOT EXISTS target_landmarks (
        id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name                    VARCHAR(128) NOT NULL,
        category                VARCHAR(32) NOT NULL,
        target_description      TEXT NOT NULL,
        location                GEOMETRY(Point, 4326) NOT NULL,
        geofence_radius_meters  DOUBLE PRECISION DEFAULT 50.0,
        source                  VARCHAR(32) NOT NULL
    )
    """,

    """
    CREATE INDEX IF NOT EXISTS idx_landmarks_location
        ON target_landmarks USING GIST(location)
    """,

    """
    CREATE TABLE IF NOT EXISTS planned_routes (
        id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id                     UUID REFERENCES users(id) ON DELETE CASCADE,
        start_location              GEOMETRY(Point, 4326) NOT NULL,
        end_location                GEOMETRY(Point, 4326) NOT NULL,
        total_distance_meters       DOUBLE PRECISION NOT NULL,
        estimated_duration_seconds  DOUBLE PRECISION NOT NULL,
        route_geometry              GEOMETRY(LineString, 4326) NOT NULL,
        created_at                  TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    """
    CREATE INDEX IF NOT EXISTS idx_planned_routes_geom
        ON planned_routes USING GIST(route_geometry)
    """,

    # estimated_tts_duration_seconds: ceil(word_count / 2.5)
    # duck_trigger: pre_arrival | on_arrival | timed
    """
    CREATE TABLE IF NOT EXISTS route_maneuvers (
        id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        route_id                        UUID REFERENCES planned_routes(id) ON DELETE CASCADE,
        sequence_order                  INTEGER NOT NULL,
        maneuver_location               GEOMETRY(Point, 4326) NOT NULL,
        maneuver_type                   VARCHAR(32) NOT NULL,
        street_name                     VARCHAR(128),
        distance_to_next_meters         DOUBLE PRECISION,
        audio_prompt_text               TEXT NOT NULL,
        estimated_tts_duration_seconds  DOUBLE PRECISION,
        duck_trigger                    VARCHAR(32) DEFAULT 'pre_arrival'
    )
    """,

    """
    CREATE TABLE IF NOT EXISTS runs (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
        planned_route_id    UUID REFERENCES planned_routes(id),
        start_time          TIMESTAMPTZ NOT NULL,
        end_time            TIMESTAMPTZ NOT NULL,
        mode                VARCHAR(16) NOT NULL,
        total_distance_km   DOUBLE PRECISION,
        average_pace_min_km DOUBLE PRECISION,
        route_path          GEOMETRY(LineString, 4326),
        synced_at           TIMESTAMPTZ DEFAULT NOW(),
        status              VARCHAR(32) DEFAULT 'pending_evaluation'
    )
    """,

    """
    CREATE INDEX IF NOT EXISTS idx_runs_path
        ON runs USING GIST(route_path)
    """,

    """
    CREATE TABLE IF NOT EXISTS quest_submissions (
        id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        run_id                      UUID REFERENCES runs(id) ON DELETE CASCADE,
        quest_type                  VARCHAR(16) NOT NULL,
        image_url_or_storage_path   TEXT,
        submission_location         GEOMETRY(Point, 4326),
        self_reported_count         INTEGER DEFAULT 0,
        matched_landmark_id         UUID REFERENCES target_landmarks(id),
        is_verified                 BOOLEAN DEFAULT FALSE,
        points_awarded              INTEGER DEFAULT 0,
        agent_narrative             TEXT,
        evaluated_at                TIMESTAMPTZ
    )
    """,
]

VERIFY_QUERIES = {
    "postgis_extension": "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
    "uuid_extension":    "SELECT extname FROM pg_extension WHERE extname = 'uuid-ossp'",
    "table_users":       "SELECT to_regclass('public.users')",
    "table_landmarks":   "SELECT to_regclass('public.target_landmarks')",
    "table_routes":      "SELECT to_regclass('public.planned_routes')",
    "table_maneuvers":   "SELECT to_regclass('public.route_maneuvers')",
    "table_runs":        "SELECT to_regclass('public.runs')",
    "table_submissions": "SELECT to_regclass('public.quest_submissions')",
    "idx_landmarks":     "SELECT to_regclass('public.idx_landmarks_location')",
    "idx_routes":        "SELECT to_regclass('public.idx_planned_routes_geom')",
    "idx_runs":          "SELECT to_regclass('public.idx_runs_path')",
}


def get_connection() -> PsycopgConnection:
    return psycopg2.connect(str(settings.database_url))


def run_migrations(conn: PsycopgConnection) -> None:
    with conn.cursor() as cur:
        for statement in DDL:
            cur.execute(statement)
    conn.commit()


def verify_schema(conn: PsycopgConnection) -> dict[str, bool]:
    results = {}
    with conn.cursor() as cur:
        for key, query in VERIFY_QUERIES.items():
            cur.execute(query)
            row = cur.fetchone()
            results[key] = row is not None and row[0] is not None
    return results


def main() -> None:
    try:
        conn = get_connection()
    except psycopg2.OperationalError as exc:
        print(f"[migrate] connection failed: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        run_migrations(conn)
        results = verify_schema(conn)
    finally:
        conn.close()

    failed = [k for k, ok in results.items() if not ok]
    if failed:
        print(f"[migrate] schema verification failed for: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)

    print("[migrate] all tables, extensions, and indexes verified.")


if __name__ == "__main__":
    main()
