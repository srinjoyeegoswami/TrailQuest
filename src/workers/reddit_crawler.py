"""
Reddit PRAW crawler for community-reported outdoor landmarks in India.

Scrapes Indian city and regional subreddits for posts mentioning outdoor spots,
trails, parks, and running routes. Sends extracted text to Gemma for structured
location parsing, then geocodes results via Nominatim.

Rate limits:
  - Reddit (PRAW):  60 requests/min on authenticated script apps (handled by PRAW).
  - Nominatim:      1 request/sec enforced via settings.nominatim_rate_limit_sec.
  - Gemma inference: no hard limit; batched per post to avoid timeout.
"""

import json
import time
import uuid
from typing import Any

import httpx
import praw
import requests

from src.config.settings import settings
from src.workers.overpass_crawler import haversine_meters, _deduplicate


# Indian city and regional subreddits to target
_SUBREDDITS = [
    "kolkata", "mumbai", "delhi", "bangalore", "hyderabad", "pune",
    "chennai", "jaipur", "ahmedabad", "kerala", "goa", "himachal",
    "uttarakhand", "india", "IndiaSocial", "nagpur", "surat", "lucknow",
    "chandigarh", "bhopal",
]

# Search terms that surface outdoor and running content
_SEARCH_TERMS = [
    "trail run", "morning run", "running route", "jogging",
    "hidden spot", "nature walk", "outdoor", "park run",
    "scenic view", "lake walk", "riverside walk", "heritage walk",
    "trekking spot", "best park", "outdoor place",
]

_GEMMA_SYSTEM_PROMPT = (
    "You are a location extraction engine. "
    "Read the post text and extract any real outdoor locations mentioned — "
    "parks, trails, lakes, rivers, heritage sites, gardens, ghats, viewpoints. "
    "Return ONLY a valid JSON array. Each element must have: "
    '{"name": string, "description": string, "city_hint": string}. '
    "description must be a 1-sentence visual description of what a runner would see there. "
    "If no outdoor locations are mentioned, return []."
)


def _build_reddit_client() -> praw.Reddit:
    return praw.Reddit(
        client_id=settings.reddit_client_id,
        client_secret=settings.reddit_client_secret,
        user_agent=settings.reddit_user_agent,
        ratelimit_seconds=300,
    )


def _query_gemma(post_text: str) -> list[dict[str, str]]:
    """
    Sends post_text to the Gemma inference endpoint.
    Returns a list of extracted location dicts, or [] on any failure.
    """
    payload = {
        "model": settings.inference_model_name,
        "messages": [
            {"role": "system", "content": _GEMMA_SYSTEM_PROMPT},
            {"role": "user", "content": post_text[:4000]},
        ],
        "temperature": 0.1,
        "max_tokens": 512,
    }

    try:
        resp = httpx.post(
            f"{settings.inference_endpoint_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.inference_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=20.0,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()

        # Strip markdown code fences if Gemma wraps output
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]

        locations = json.loads(content)
        if isinstance(locations, list):
            return locations
        return []

    except (httpx.HTTPError, KeyError, json.JSONDecodeError):
        return []


def _geocode(name: str, city_hint: str) -> tuple[float, float] | None:
    """
    Resolves a location name to (lat, lon) via Nominatim.
    Appends ', India' to constrain results geographically.
    Enforces 1 req/sec per OSM usage policy.
    """
    time.sleep(settings.nominatim_rate_limit_sec)
    query = f"{name}, {city_hint}, India" if city_hint else f"{name}, India"
    try:
        resp = requests.get(
            f"{settings.nominatim_url}/search",
            params={"q": query, "format": "json", "limit": 1, "countrycodes": "in"},
            headers={"User-Agent": settings.nominatim_user_agent},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
        if results:
            return float(results[0]["lat"]), float(results[0]["lon"])
        return None
    except (requests.RequestException, KeyError, ValueError):
        return None


def _fetch_posts(reddit: praw.Reddit, limit: int) -> list[dict[str, str]]:
    """
    Fetches posts from all target subreddits across all search terms.
    Returns deduplicated list of {title, body, subreddit} dicts.
    """
    seen_ids: set[str] = set()
    posts: list[dict[str, str]] = []

    per_term_limit = max(5, limit // len(_SEARCH_TERMS))

    for term in _SEARCH_TERMS:
        for subreddit_name in _SUBREDDITS:
            try:
                subreddit = reddit.subreddit(subreddit_name)
                for submission in subreddit.search(term, limit=per_term_limit, sort="relevance"):
                    if submission.id in seen_ids:
                        continue
                    seen_ids.add(submission.id)
                    body = (submission.selftext or "").strip()
                    text = f"{submission.title}\n{body}".strip()
                    if len(text) < 30:
                        continue
                    posts.append({
                        "text": text,
                        "subreddit": subreddit_name,
                    })
                    if len(posts) >= limit * 3:
                        return posts
            except praw.exceptions.PRAWException:
                continue

    return posts


def _fetch_posts_apify(token: str, limit: int) -> list[dict[str, str]]:
    """
    Fetches posts via Apify Reddit Scraper API.
    Bypasses official Reddit application review and IP rate-limits using Apify cloud actors.
    """
    actor_id = settings.apify_actor_id.replace("/", "~")
    endpoint = f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items?token={token}"

    start_urls = []
    for sub in _SUBREDDITS[:8]:
        for term in _SEARCH_TERMS[:3]:
            start_urls.append({
                "url": f"https://www.reddit.com/r/{sub}/search/?q={term.replace(' ', '+')}&restrict_sr=1"
            })

    payload = {
        "startUrls": start_urls[:min(len(start_urls), max(5, limit // 2))],
        "maxItems": limit,
        "maxPosts": limit,
        "skipComments": True,
        "searches": [
            {"subreddit": sub, "query": term}
            for sub in _SUBREDDITS[:5]
            for term in _SEARCH_TERMS[:2]
        ],
    }

    try:
        resp = httpx.post(endpoint, json=payload, timeout=90.0)
        resp.raise_for_status()
        items = resp.json()
        if not isinstance(items, list):
            return []

        posts = []
        for item in items:
            title = (item.get("title") or item.get("postTitle") or "").strip()
            body = (item.get("body") or item.get("selftext") or item.get("text") or "").strip()
            sub = item.get("subreddit") or item.get("communityName") or "reddit"
            text = f"{title}\n{body}".strip()
            if len(text) >= 30:
                posts.append({"text": text, "subreddit": sub})
        return posts
    except Exception as exc:
        print(f"[reddit/apify] Apify request failed: {exc}")
        return []


def crawl(
    limit: int = 100,
    existing: list[dict] | None = None,
) -> list[dict]:
    """
    Scrapes Indian subreddits, extracts locations via Gemma, geocodes via Nominatim.
    Deduplicates against `existing` records using settings.dedup_radius_meters.
    Returns a list of new landmark dicts ready for JSON serialisation.
    """
    existing = existing or []

    if settings.apify_api_token:
        print("[reddit] using Apify cloud scraper API (no Reddit approval needed)")
        posts = _fetch_posts_apify(settings.apify_api_token, limit)
    elif settings.reddit_client_id and settings.reddit_client_secret:
        print("[reddit] using PRAW official Reddit client")
        reddit = _build_reddit_client()
        posts = _fetch_posts(reddit, limit)
    else:
        print("[reddit] Neither APIFY_API_TOKEN nor REDDIT_CLIENT_ID configured in .env. Skipping Reddit.")
        return []
    print(f"[reddit] fetched {len(posts)} posts across {len(_SUBREDDITS)} subreddits")

    raw_locations: list[dict[str, Any]] = []
    for post in posts:
        extracted = _query_gemma(post["text"])
        for loc in extracted:
            loc["subreddit"] = post["subreddit"]
            raw_locations.append(loc)

    print(f"[reddit] Gemma extracted {len(raw_locations)} location mentions")

    landmarks: list[dict] = []
    for loc in raw_locations:
        name = (loc.get("name") or "").strip()
        description = (loc.get("description") or "").strip()
        city_hint = (loc.get("city_hint") or "").strip()

        if not name or not description:
            continue

        coords = _geocode(name, city_hint)
        if coords is None:
            print(f"[reddit] could not geocode: '{name}, {city_hint}'")
            continue

        lat, lon = coords
        landmarks.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "locality": city_hint,
            "city": city_hint,
            "state": "",
            "category": "scenic_view",
            "target_description": description,
            "latitude": lat,
            "longitude": lon,
            "geofence_radius_meters": 50.0,
            "source": "mined_reddit",
        })

    deduped = _deduplicate(landmarks, existing, settings.dedup_radius_meters)
    print(f"[reddit] {len(landmarks)} geocoded → {len(deduped)} after dedup")
    return deduped
