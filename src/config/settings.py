from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    postgres_user: str = "postgres"
    postgres_password: str = "postgres"
    postgres_db: str = "trailquest"

    osrm_base_url: str = "http://localhost:5000/route/v1/foot"

    inference_endpoint_url: str
    inference_api_key: str
    inference_model_name: str = "gemma-3"

    hermes_skills_dir: str = "~/.hermes/skills"

    # Reddit scraping — Apify cloud scraper (instant access, no developer review required)
    apify_api_token: str = ""
    apify_actor_id: str = "apify/reddit-scraper"

    # Official Reddit API credentials (optional fallback)
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "trailquest-harvester/1.0"

    overpass_url: str = "https://overpass-api.de/api/interpreter"
    overpass_timeout: int = 60

    nominatim_url: str = "https://nominatim.openstreetmap.org"
    nominatim_user_agent: str = "trailquest-harvester/1.0"
    nominatim_rate_limit_sec: float = 1.0

    dedup_radius_meters: float = 50.0

    # Hausdorff deviation limit — runs beyond this are marked non-adherent
    route_adherence_threshold_meters: float = 75.0

    # Minimum Gemma confidence to award visual quest points
    vision_confidence_threshold: float = 0.70

    # Pace drop % that triggers friendly_savage to switch to savage prompts
    persona_pace_drop_threshold: float = 15.0

    db_port: int = 5432
    osrm_port: int = 5000

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
