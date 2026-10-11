<<<<<<< HEAD
# TrailQuest Backend & Agent Service

> Screen-free, audio-guided outdoor exploration running platform powered by open-weight AI (Gemma), Hermes Agent, PostGIS, and OSRM. Built for the Hacktoberfest "Touch Grass" challenge.

---

## Architecture Overview
- **Screen-Free Audio Guidance**: Routes are compiled into natural-language speech prompts on the backend and voiced using device-native TTS with music ducking, keeping runners off their screens.
- **Dual Voice Profiles**: Switchable between `friendly` and `full_savage` personas, including automatic pace-drop alerts and a halfway 2-minute fatigue break trigger (`config/voice_profiles.json`).
- **Offline-First Synchronization**: Telemetry coordinates and quest photos are buffered on the device during runs with zero cellular dependency, then synced within 24 hours of reconnecting.
- **Open-Weight AI Pipeline**: Gemma serves as the multimodal vision evaluator on DigitalOcean Serverless Inference / Ollama, orchestrated by Hermes Agent.
- **Two-Tiered Landmark Storage**: Separates verified baseline locations (`data/landmarks/curated_landmarks.json`) from dynamically mined regional discoveries (`data/landmarks/mined_landmarks.json`).

---

## Quickstart

### 1. Environment Setup
Copy `.env.example` to `.env` and fill in your connection details:
```bash
cp .env.example .env

Required variables in .env:

Ini, TOML
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trailquest
OSRM_BASE_URL=http://localhost:5000/route/v1/foot
INFERENCE_ENDPOINT_URL=[https://inference.digitalocean.com/v1](https://inference.digitalocean.com/v1)
INFERENCE_API_KEY=your_inference_api_key
INFERENCE_MODEL_NAME=gemma-3
2. Launch Local Database & OSRM Engine
Bash
docker compose up -d
3. Run Database Migrations
Bash
python -m src.db.migrate
4. Seed Curated & Mined Landmarks
Bash
# Seed verified baseline landmarks
python -m src.workers.landmark_seeder --file=data/landmarks/curated_landmarks.json

# Extract dynamic OSM and Reddit landmarks for your district
python -m src.workers.india_harvester --mode=osm --district="Kolkata" --state="West Bengal" --out=data/landmarks/mined_landmarks.json
python -m src.workers.india_harvester --mode=reddit --limit=50 --out=data/landmarks/mined_landmarks.json
5. Start Backend API Server
Bash
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
File Usage & Placement Guide
Where to place: Save this file in the root directory as README.md.

When to use: Use this as the main technical reference and setup guide when configuring containers, environment variables, and worker scripts on a local machine or remote Droplet.
=======
# TrailQuest
>>>>>>> f58cb9eae5b5a30484bf36ce16439868de54570c
