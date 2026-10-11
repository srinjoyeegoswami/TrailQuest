```markdown
# SKILL.md — Hermes Agent Skill Definition

This document defines the skill manifest registered with the Hermes Agent runtime.

## Skill Identity
- **Name**: `route_and_quest_director`
- **Description**: Evaluates completed runs, verifies trail landmark photos using Gemma, measures route deviation using PostGIS, and calculates quest rewards.

---

## Manifest (`skill.json`)

```json
{
  "name": "route_and_quest_director",
  "version": "1.0.0",
  "description": "Orchestrates spatial route evaluation and visual quest verification for TrailQuest",
  "tools": [
    {
      "name": "evaluate_run_navigation_accuracy",
      "description": "Calculates Hausdorff distance between planned route and actual GPS trajectory",
      "parameters": {
        "type": "object",
        "properties": {
          "planned_route_id": { "type": "string", "description": "UUID of planned route" },
          "run_id": { "type": "string", "description": "UUID of the completed run" }
        },
        "required": ["planned_route_id", "run_id"]
      }
    },
    {
      "name": "run_gemma_vision_verifier",
      "description": "Uses Gemma to evaluate if a submitted image matches the target landmark description",
      "parameters": {
        "type": "object",
        "properties": {
          "image_path": { "type": "string", "description": "Storage path of the submitted photo" },
          "landmark_target_description": { "type": "string", "description": "Target visual description" }
        },
        "required": ["image_path", "landmark_target_description"]
      }
    },
    {
      "name": "tally_quest_score",
      "description": "Calculates points for distance, adherence, verified landmarks, and social interactions",
      "parameters": {
        "type": "object",
        "properties": {
          "run_id": { "type": "string" },
          "mode": { "type": "string", "enum": ["running", "walking"] },
          "total_distance_km": { "type": "number" },
          "is_route_adherent": { "type": "boolean" },
          "verified_landmarks_count": { "type": "integer" },
          "social_interactions_count": { "type": "integer" }
        },
        "required": ["run_id", "mode", "total_distance_km", "is_route_adherent"]
      }
    }
  ]
}
Agent Invocation Loop
Client batch sync is received at /api/v1/sync/run-payload.

Backend persists raw telemetry and marks run status as pending_evaluation.

Background task triggers Hermes Agent using this skill definition.

Hermes Agent executes evaluate_run_navigation_accuracy against PostGIS.

Hermes Agent iterates through all visual submissions and executes run_gemma_vision_verifier.

Hermes Agent executes tally_quest_score, updates Postgres records, and sets run status to processed.

File Usage & Placement Guide
Where to place: Save this file in the root directory as SKILL.md. In addition, extract only the inner JSON object and save it directly as ~/.hermes/skills/route_and_quest_director/skill.json.

When to use: Use this to register the custom tools with Hermes Agent so it can execute your PostGIS, Gemma, and reward calculation tools.