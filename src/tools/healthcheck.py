"""
TrailQuest system health checker.
Run with: python -m src.tools.healthcheck

Checks every backend dependency in sequence and renders a Rich table.
Exit code 0 = all systems up. Exit code 1 = one or more failures.
"""

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import psycopg2
from rich.console import Console
from rich.table import Table
from rich import box

from src.config.settings import settings

console = Console()

CURATED_FILE  = Path("data/landmarks/curated_landmarks.json")
MINED_FILE    = Path("data/landmarks/mined_landmarks.json")
VOICE_CONFIG  = Path("config/voice_profiles.json")
HERMES_SKILL  = Path(os.path.expanduser(settings.hermes_skills_dir)) / "route_and_quest_director" / "skill.json"

REQUIRED_PERSONA_KEYS = {"friendly", "full_savage", "friendly_savage"}
REQUIRED_TABLES = {
    "users", "target_landmarks", "planned_routes",
    "route_maneuvers", "runs", "quest_submissions",
}
REQUIRED_INDEXES = {
    "idx_landmarks_location", "idx_planned_routes_geom", "idx_runs_path",
}


# ── Checks ────────────────────────────────────────────────────────────────────

def check_postgres() -> tuple[bool, str]:
    try:
        conn = psycopg2.connect(str(settings.database_url), connect_timeout=5)
        conn.close()
        return True, str(settings.database_url).split("@")[-1]
    except psycopg2.OperationalError as exc:
        return False, str(exc).strip()


def check_postgis(conn) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'postgis'")
        row = cur.fetchone()
    if row:
        return True, f"v{row[0]}"
    return False, "extension not found"


def check_tables(conn) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """)
        found = {r[0] for r in cur.fetchall()}
    missing = REQUIRED_TABLES - found
    if missing:
        return False, f"missing: {', '.join(sorted(missing))}"
    return True, f"{len(REQUIRED_TABLES)} tables present"


def check_indexes(conn) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public'
        """)
        found = {r[0] for r in cur.fetchall()}
    missing = REQUIRED_INDEXES - found
    if missing:
        return False, f"missing GIST indexes: {', '.join(sorted(missing))}"
    return True, "GIST indexes confirmed"


def check_landmark_counts(conn) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM target_landmarks")
        count = cur.fetchone()[0]
    return True, f"{count} records"


def check_osrm() -> tuple[bool, str]:
    base = str(settings.osrm_base_url).rstrip("/").rsplit("/route/v1/foot", 1)[0]
    try:
        r = httpx.get(f"{base}/health", timeout=5.0)
        if r.status_code == 200:
            return True, base
        # OSRM < 5.24 has no /health — fall back to a minimal route probe
        probe = f"{settings.osrm_base_url}/13.388860,52.517037;13.397634,52.529407"
        r2 = httpx.get(probe, timeout=5.0)
        if r2.status_code == 200:
            return True, f"{base} (probe OK)"
        return False, f"HTTP {r2.status_code}"
    except httpx.ConnectError:
        return False, "connection refused on port 5000"
    except httpx.TimeoutException:
        return False, "timeout after 5s"


def check_gemma() -> tuple[bool, str]:
    try:
        r = httpx.get(
            f"{settings.inference_endpoint_url}/models",
            headers={"Authorization": f"Bearer {settings.inference_api_key}"},
            timeout=8.0,
        )
        if r.status_code == 200:
            return True, settings.inference_model_name
        return False, f"HTTP {r.status_code}"
    except httpx.ConnectError:
        return False, "connection refused"
    except httpx.TimeoutException:
        return False, "timeout after 8s"


def check_hermes_skill() -> tuple[bool, str]:
    if not HERMES_SKILL.exists():
        return False, f"not found: {HERMES_SKILL}"
    try:
        data = json.loads(HERMES_SKILL.read_text())
        tools = {t["name"] for t in data.get("tools", [])}
        required = {
            "evaluate_run_navigation_accuracy",
            "run_gemma_vision_verifier",
            "tally_quest_score",
        }
        missing = required - tools
        if missing:
            return False, f"missing tools: {', '.join(sorted(missing))}"
        return True, f"3 tools registered"
    except (json.JSONDecodeError, KeyError) as exc:
        return False, f"invalid skill.json: {exc}"


def check_curated_file() -> tuple[bool, str]:
    if not CURATED_FILE.exists():
        return False, f"not found: {CURATED_FILE}"
    try:
        data = json.loads(CURATED_FILE.read_text())
        stat = CURATED_FILE.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d")
        return True, f"{len(data)} records · last modified {mtime}"
    except json.JSONDecodeError as exc:
        return False, f"invalid JSON: {exc}"


def check_mined_file() -> tuple[bool, str]:
    if not MINED_FILE.exists():
        return False, f"not found: {MINED_FILE}"
    try:
        data = json.loads(MINED_FILE.read_text())
        return True, f"{len(data)} records"
    except json.JSONDecodeError as exc:
        return False, f"invalid JSON: {exc}"


def check_voice_config() -> tuple[bool, str]:
    if not VOICE_CONFIG.exists():
        return False, f"not found: {VOICE_CONFIG}"
    try:
        data = json.loads(VOICE_CONFIG.read_text())
        version = data.get("version", "unknown")
        profiles = set(data.get("profiles", {}).keys())
        missing = REQUIRED_PERSONA_KEYS - profiles
        if missing:
            return False, f"missing personas: {', '.join(sorted(missing))}"
        return True, f"v{version} · {len(profiles)} personas loaded"
    except json.JSONDecodeError as exc:
        return False, f"invalid JSON: {exc}"


# ── Renderer ──────────────────────────────────────────────────────────────────

def build_table() -> tuple[Table, bool]:
    table = Table(
        title=f"TrailQuest System Status  [{datetime.now().strftime('%Y-%m-%d %H:%M:%S IST')}]",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold white",
        title_style="bold cyan",
        min_width=72,
    )
    table.add_column("Service", style="bold", width=34)
    table.add_column("Status", width=10, justify="center")
    table.add_column("Detail", style="dim")

    all_ok = True

    # ── PostgreSQL connection
    ok, detail = check_postgres()
    table.add_row("PostgreSQL", _badge(ok), detail)
    all_ok = all_ok and ok

    if ok:
        try:
            conn = psycopg2.connect(str(settings.database_url), connect_timeout=5)

            ok2, detail2 = check_postgis(conn)
            table.add_row("PostGIS Extension", _badge(ok2), detail2)
            all_ok = all_ok and ok2

            ok3, detail3 = check_tables(conn)
            table.add_row("Schema Tables", _badge(ok3), detail3)
            all_ok = all_ok and ok3

            ok4, detail4 = check_indexes(conn)
            table.add_row("GIST Indexes", _badge(ok4), detail4)
            all_ok = all_ok and ok4

            ok5, detail5 = check_landmark_counts(conn)
            table.add_row("DB Landmark Records", _badge(ok5), detail5)

            conn.close()
        except psycopg2.OperationalError:
            pass
    else:
        for label in ("PostGIS Extension", "Schema Tables", "GIST Indexes", "DB Landmark Records"):
            table.add_row(label, "[yellow]SKIP[/yellow]", "postgres offline")

    table.add_section()

    # ── OSRM
    ok, detail = check_osrm()
    table.add_row("OSRM Foot Engine", _badge(ok), detail)
    all_ok = all_ok and ok

    # ── Gemma inference
    ok, detail = check_gemma()
    table.add_row("Gemma Inference", _badge(ok), detail)
    all_ok = all_ok and ok

    # ── Hermes skill
    ok, detail = check_hermes_skill()
    table.add_row("Hermes Agent Skill", _badge(ok), detail)
    all_ok = all_ok and ok

    table.add_section()

    # ── File checks
    ok, detail = check_curated_file()
    table.add_row("Curated Landmarks (read-only)", _badge(ok), detail)
    all_ok = all_ok and ok

    ok, detail = check_mined_file()
    table.add_row("Mined Landmarks", _badge(ok), detail)

    ok, detail = check_voice_config()
    table.add_row("Voice Profiles Config", _badge(ok), detail)
    all_ok = all_ok and ok

    table.add_section()

    overall_label = "[bold green]ALL SYSTEMS GO[/bold green]" if all_ok else "[bold red]DEGRADED — CHECK ABOVE[/bold red]"
    table.add_row("Overall", _badge(all_ok), overall_label)

    return table, all_ok


def _badge(ok: bool) -> str:
    return "[bold green]✅ UP[/bold green]" if ok else "[bold red]❌ DOWN[/bold red]"


def main() -> None:
    table, all_ok = build_table()
    console.print()
    console.print(table)
    console.print()
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
