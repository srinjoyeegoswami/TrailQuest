```markdown
# docs/todo.md — Development Roadmap & Action Items

## Phase 1: Database & Core Infrastructure
- [x] Initialize PostgreSQL with PostGIS extension.
- [x] Apply database schema migrations for users, landmarks, routes, and submissions.
- [x] Configure `docker-compose.yml` for local database and OSRM services.

## Phase 2: Pan-India Data Harvester
- [x] Build Reddit crawler (`src/workers/reddit_crawler.py`) targeting Indian state/city subreddits.
- [x] Build OpenStreetMap Overpass extractor (`src/workers/overpass_crawler.py`) for towns and rural areas.
- [x] Integrate Gemma parser to extract structured landmarks from unstructured posts.
- [x] Set up Nominatim forward geocoding with 50-meter PostGIS deduplication.

## Phase 3: Routing & Spoken Audio Maneuver Compiler
- [x] Implement OSRM foot routing client in `src/services/routing/`.
- [x] Build multi-waypoint loop builder (`origin -> landmarks -> origin`).
- [x] Implement natural-language audio cue compiler for turns and landmark proximity.

## Phase 4: Offline Batch Sync & Hermes Agent Integration
- [x] Implement `POST /api/v1/sync/run-payload` ingestion endpoint.
- [x] Reconstruct `ST_LineString` trajectories from GPS telemetry points.
- [x] Build Hermes Agent custom skills in `src/agent/hermes/skill.json`.
- [x] Implement Hausdorff distance navigation accuracy tool.
- [x] Implement Gemma multimodal photo verification tool.
- [x] Implement score and badge tallying tool.

## Phase 5: Verification & Sign-off
- [x] Run end-to-end sync verification using mock GPS tracks and test images.
- [x] Signal completion to request frontend requirements.

---

## File Usage & Placement Guide
* **Where to place**: Save this file in the `docs/` folder as `docs/todo.md`.
* **When to use**: Use this as an active progress tracker. Check off items as you finish them during development to keep work organized.