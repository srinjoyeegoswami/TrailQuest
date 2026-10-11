"""
Spoken Audio Maneuver Compiler.
Compiles OSRM route legs and landmark waypoints into natural-language audio cues
adhering to the voice profiles and music-ducking contracts in config/voice_profiles.json.
"""

import json
from pathlib import Path
from typing import Any

VOICE_PROFILES_FILE = Path("config/voice_profiles.json")


def _load_voice_profiles() -> dict[str, Any]:
    if not VOICE_PROFILES_FILE.exists():
        return {}
    try:
        return json.loads(VOICE_PROFILES_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _calc_tts_duration(text: str) -> float:
    """Estimated TTS duration: word count / 2.5 seconds per word."""
    words = len(text.strip().split())
    return max(1.0, round(words / 2.5, 1))


def _format_turn_direction(modifier: str) -> str:
    """Formats OSRM maneuver modifier into spoken direction."""
    mapping = {
        "left": "left",
        "right": "right",
        "slight left": "slightly left",
        "slight right": "slightly right",
        "sharp left": "sharp left",
        "sharp right": "sharp right",
        "straight": "straight",
        "uturn": "around",
    }
    return mapping.get(modifier.lower(), "ahead")


def compile_maneuvers(
    route_data: dict[str, Any],
    persona_name: str = "friendly_savage",
) -> list[dict[str, Any]]:
    """
    Translates route legs, steps, and target landmarks into an ordered sequence
    of spoken audio maneuvers with precise ducking triggers.
    """
    config = _load_voice_profiles()
    profiles = config.get("profiles", {})
    profile = profiles.get(persona_name, profiles.get("friendly", {}))
    prompts = profile.get("prompts", {})

    turn_template = prompts.get("turn_maneuver", "In {distance} meters, turn {turn_direction} onto {street_name}.")
    landmark_100_prompts = prompts.get("landmark_proximity", ["{landmark_name} is about 100 meters out."])
    fatigue_prompts = prompts.get("fatigue_break_2min", ["You're at the halfway point. Take two minutes to walk."])

    maneuvers: list[dict[str, Any]] = []
    seq = 1

    legs = route_data.get("legs", [])
    landmarks = route_data.get("landmarks", [])
    total_dist = route_data.get("total_distance_meters", 0.0)
    halfway_dist = total_dist / 2.0
    accumulated_dist = 0.0
    fatigue_inserted = False

    # 1. Opening maneuver
    start_loc = route_data.get("origin", {"latitude": 0.0, "longitude": 0.0})
    opening_text = f"Route planned: {total_dist / 1000.0:.1f} kilometers loop. Begin moving forward."
    maneuvers.append({
        "sequence_order": seq,
        "maneuver_location": start_loc,
        "maneuver_type": "depart",
        "street_name": "Starting Location",
        "distance_to_next_meters": 50.0,
        "audio_prompt_text": opening_text,
        "estimated_tts_duration_seconds": _calc_tts_duration(opening_text),
        "duck_trigger": "pre_arrival",
    })
    seq += 1

    # 2. Iterate OSRM legs and steps
    for leg_idx, leg in enumerate(legs):
        steps = leg.get("steps", [])

        # Check if approaching a landmark at the end of this leg
        current_landmark = landmarks[leg_idx] if leg_idx < len(landmarks) else None

        for step in steps:
            dist = float(step.get("distance", 0.0))
            name = step.get("name") or "the road"
            maneuver_info = step.get("maneuver", {})
            m_type = maneuver_info.get("type", "continue")
            m_mod = maneuver_info.get("modifier", "straight")
            loc = maneuver_info.get("location", [start_loc.get("longitude", 0.0), start_loc.get("latitude", 0.0)])
            point = {"latitude": loc[1], "longitude": loc[0]}

            accumulated_dist += dist

            # Check if halfway fatigue prompt should be triggered
            if not fatigue_inserted and accumulated_dist >= halfway_dist:
                fatigue_text = fatigue_prompts[0]
                maneuvers.append({
                    "sequence_order": seq,
                    "maneuver_location": point,
                    "maneuver_type": "fatigue_break",
                    "street_name": name,
                    "distance_to_next_meters": 0.0,
                    "audio_prompt_text": fatigue_text,
                    "estimated_tts_duration_seconds": _calc_tts_duration(fatigue_text),
                    "duck_trigger": "timed",
                })
                seq += 1
                fatigue_inserted = True

            # Don't announce trivial or end steps
            if m_type in ("arrive", "depart") and dist < 15.0:
                continue

            direction = _format_turn_direction(m_mod)
            dist_int = int(round(dist / 10.0) * 10)
            if dist_int <= 0:
                dist_int = 20

            prompt_text = turn_template.format(
                distance=dist_int,
                turn_direction=direction,
                street_name=name,
            )

            maneuvers.append({
                "sequence_order": seq,
                "maneuver_location": point,
                "maneuver_type": f"{m_type}_{m_mod}".replace(" ", "_"),
                "street_name": name,
                "distance_to_next_meters": dist,
                "audio_prompt_text": prompt_text,
                "estimated_tts_duration_seconds": _calc_tts_duration(prompt_text),
                "duck_trigger": "pre_arrival",
            })
            seq += 1

        # 3. Add landmark proximity alerts if arrived near a landmark
        if current_landmark:
            lm_name = current_landmark["name"]
            lm_desc = current_landmark.get("target_description", "landmark")
            lm_point = {
                "latitude": current_landmark["latitude"],
                "longitude": current_landmark["longitude"],
            }

            # 100m proximity cue
            prompt_100 = landmark_100_prompts[0].format(
                landmark_name=lm_name,
                target_description=lm_desc,
            )
            maneuvers.append({
                "sequence_order": seq,
                "maneuver_location": lm_point,
                "maneuver_type": "landmark_approach",
                "street_name": lm_name,
                "distance_to_next_meters": 100.0,
                "audio_prompt_text": prompt_100,
                "estimated_tts_duration_seconds": _calc_tts_duration(prompt_100),
                "duck_trigger": "pre_arrival",
            })
            seq += 1

            # 50m visual photo prompt
            prompt_50 = f"You are 50 meters from {lm_name}. Prepare your camera to verify this quest target."
            maneuvers.append({
                "sequence_order": seq,
                "maneuver_location": lm_point,
                "maneuver_type": "landmark_arrival",
                "street_name": lm_name,
                "distance_to_next_meters": 50.0,
                "audio_prompt_text": prompt_50,
                "estimated_tts_duration_seconds": _calc_tts_duration(prompt_50),
                "duck_trigger": "on_arrival",
            })
            seq += 1

    # 4. Final finish prompt
    finish_text = "Quest route completed. Great run today!"
    maneuvers.append({
        "sequence_order": seq,
        "maneuver_location": start_loc,
        "maneuver_type": "finish",
        "street_name": "Destination",
        "distance_to_next_meters": 0.0,
        "audio_prompt_text": finish_text,
        "estimated_tts_duration_seconds": _calc_tts_duration(finish_text),
        "duck_trigger": "on_arrival",
    })

    return maneuvers
