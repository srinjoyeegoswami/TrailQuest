# docs/specs.md — TrailQuest Technical Specifications

## 1. System Overview
TrailQuest is an offline-first, screen-free outdoor exploration and running platform. Runners receive dynamic turn-by-turn audio cues and landmark prompts via local Text-to-Speech (TTS), with background music ducking. Completed runs are buffered offline and synchronized within 24 hours to an open-weight AI evaluation engine (Hermes Agent + Gemma).

---

## 2. Infrastructure & Services
* **Database**: PostgreSQL 16+ with PostGIS (`ST_Point`, `ST_LineString`, `ST_DWithin`, `ST_HausdorffDistance`).
* **Routing Engine**: Self-hosted OSRM (`/route/v1/foot`) using local OpenStreetMap extracts.
* **AI Inference**: Gemma running on DigitalOcean Serverless Inference / Ollama.
* **Agent Engine**: Hermes Agent runtime executing custom registered skills.
* **Data Mining**: PRAW (Reddit crawler) + Overpass API (OSM landmark extractor).

---

## 3. Database Schema (PostgreSQL + PostGIS)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(64) UNIQUE NOT NULL,
    total_points INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE target_landmarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    category VARCHAR(32) NOT NULL,
    target_description TEXT NOT NULL,
    location GEOMETRY(Point, 4326) NOT NULL,
    geofence_radius_meters DOUBLE PRECISION DEFAULT 50.0,
    source VARCHAR(32) NOT NULL
);
CREATE INDEX idx_landmarks_location ON target_landmarks USING GIST(location);

CREATE TABLE planned_routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    start_location GEOMETRY(Point, 4326) NOT NULL,
    end_location GEOMETRY(Point, 4326) NOT NULL,
    total_distance_meters DOUBLE PRECISION NOT NULL,
    estimated_duration_seconds DOUBLE PRECISION NOT NULL,
    route_geometry GEOMETRY(LineString, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_planned_routes_geom ON planned_routes USING GIST(route_geometry);

-- estimated_tts_duration_seconds: word_count / 2.5, rounded up.
-- duck_trigger values: pre_arrival | on_arrival | timed
CREATE TABLE route_maneuvers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_id UUID REFERENCES planned_routes(id) ON DELETE CASCADE,
    sequence_order INTEGER NOT NULL,
    maneuver_location GEOMETRY(Point, 4326) NOT NULL,
    maneuver_type VARCHAR(32) NOT NULL,
    street_name VARCHAR(128),
    distance_to_next_meters DOUBLE PRECISION,
    audio_prompt_text TEXT NOT NULL,
    estimated_tts_duration_seconds DOUBLE PRECISION,
    duck_trigger VARCHAR(32) DEFAULT 'pre_arrival'
);

CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    planned_route_id UUID REFERENCES planned_routes(id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    mode VARCHAR(16) NOT NULL,
    total_distance_km DOUBLE PRECISION,
    average_pace_min_km DOUBLE PRECISION,
    route_path GEOMETRY(LineString, 4326),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(32) DEFAULT 'pending_evaluation'
);
CREATE INDEX idx_runs_path ON runs USING GIST(route_path);

CREATE TABLE quest_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
    quest_type VARCHAR(16) NOT NULL,
    image_url_or_storage_path TEXT,
    submission_location GEOMETRY(Point, 4326),
    self_reported_count INTEGER DEFAULT 0,
    matched_landmark_id UUID REFERENCES target_landmarks(id),
    is_verified BOOLEAN DEFAULT FALSE,
    points_awarded INTEGER DEFAULT 0,
    agent_narrative TEXT,
    evaluated_at TIMESTAMPTZ
);
```

---

## 4. Music Ducking Config Contract

Defined per persona in `config/voice_profiles.json` under `music_ducking`:

| Field | Type | Description |
|---|---|---|
| `duck_level` | float (0.0–1.0) | Music volume fraction while TTS is active |
| `fade_out_ms` | integer | Milliseconds to ramp music down before TTS fires |
| `fade_in_ms` | integer | Milliseconds to ramp music back up after TTS ends |
| `pre_speech_delay_ms` | integer | Silent buffer between duck completion and TTS start |

Per-persona values:

| Persona | duck_level | fade_out_ms | fade_in_ms | pre_speech_delay_ms |
|---|---|---|---|---|
| `friendly` | 0.15 | 400 | 800 | 200 |
| `full_savage` | 0.12 | 200 | 600 | 100 |
| `friendly_savage` | 0.13 | 300 | 700 | 150 |

---

## 5. Voice Persona Contract

Three personas defined in `config/voice_profiles.json` v1.1.0:

| Persona | Switching Logic |
|---|---|
| `friendly` | Always uses friendly prompt bank |
| `full_savage` | Always uses savage prompt bank |
| `friendly_savage` | Performance-gated: friendly when pace within 15% of baseline; savage when pace drops ≥ 15%. Landmark proximity always friendly. Turn maneuvers always neutral. Fatigue break opens friendly, closes savage. |

---

## 6. API Endpoints

### POST /api/v1/routes/plan-quest-run
Generates a closed-loop quest route and audio prompts.

```json
{
  "user_id": "UUID",
  "origin": { "latitude": 22.5726, "longitude": 88.3639 },
  "max_distance_km": 5.0,
  "desired_categories": ["park", "flora", "scenic_view"]
}
```

**Response includes per maneuver:**
```json
{
  "sequence_order": 1,
  "maneuver_type": "turn_right",
  "street_name": "Park Street",
  "distance_to_next_meters": 320.0,
  "audio_prompt_text": "In 320 meters, turn right onto Park Street.",
  "estimated_tts_duration_seconds": 3.2,
  "duck_trigger": "pre_arrival"
}
```

### POST /api/v1/sync/run-payload
Ingests offline runs within a 24-hour sync window.

```json
{
  "user_id": "UUID",
  "planned_route_id": "UUID-or-null",
  "run": {
    "start_time": "2026-10-11T06:00:00Z",
    "end_time": "2026-10-11T06:35:00Z",
    "mode": "running",
    "telemetry_points": [
      {"latitude": 22.5726, "longitude": 88.3639, "timestamp": "2026-10-11T06:00:00Z", "speed": 3.1}
    ]
  },
  "quest_submissions": [
    {
      "quest_type": "visual",
      "image_base64_or_path": "string",
      "latitude": 22.5740,
      "longitude": 88.3650,
      "timestamp": "2026-10-11T06:12:00Z"
    },
    {
      "quest_type": "social",
      "self_reported_count": 2,
      "timestamp": "2026-10-11T06:25:00Z"
    }
  ]
}
```

---

## 7. Spatial Algorithm Reference

### Hausdorff Route Deviation
Executed by Hermes Tool 1. Both geometries projected to SRID 3857 (metric) before comparison.
Adherence threshold: ≤ 75.0 meters.

```sql
SELECT ST_HausdorffDistance(
  ST_Transform(p.route_geometry, 3857),
  ST_Transform(r.route_path, 3857)
) AS deviation_meters
FROM planned_routes p, runs r
WHERE p.id = :planned_route_id AND r.id = :run_id;
```

### Landmark Geofence Check
```sql
SELECT id, name FROM target_landmarks
WHERE ST_DWithin(
  location::geography,
  ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography,
  geofence_radius_meters
);
```

---

## 8. Scoring Matrix

| Event | Points |
|---|---|
| Distance | 10 pts/km |
| Navigation adherence (Hausdorff ≤ 75m) | +50 pts |
| Visual quest verified (confidence ≥ 0.70, running) | +150 pts |
| Visual quest verified (confidence ≥ 0.70, walking) | +100 pts |
| Social greeting validated | +15 pts each |

---

## 9. Data Boundary Rules

| File | Access |
|---|---|
| `data/landmarks/curated_landmarks.json` | Read-only. Never written by any automated process. |
| `data/landmarks/mined_landmarks.json` | Sole write target for Overpass and Reddit harvesters. |
