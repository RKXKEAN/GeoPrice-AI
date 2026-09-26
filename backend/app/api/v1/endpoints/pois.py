import json
import logging
from typing import List, Dict, Any
from pathlib import Path
from fastapi import APIRouter, Query, status
import httpx

router = APIRouter()
logger = logging.getLogger(__name__)

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
USER_AGENT = "GeoPriceAI/1.0 (contact: admin@geoprice.ai)"

# In-memory cache for fast lookups
_poi_cache: Dict[str, List[Dict[str, Any]]] = {}

# Path to local landmarks JSON fallback inside backend/app/data
LANDMARKS_FILE = Path(__file__).resolve().parents[3] / "data" / "hatyai_landmarks.json"

def _get_fallback_landmarks(lat: float, lon: float, radius_m: float = 3000.0) -> List[Dict[str, Any]]:
    """Return local curated landmarks from hatyai_landmarks.json as fallback."""
    if not LANDMARKS_FILE.exists():
        logger.warning(f"Landmarks fallback file not found at {LANDMARKS_FILE}")
        return []

    try:
        with open(LANDMARKS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        fallback_pois = []
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            geom = feature.get("geometry", {})
            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                continue
            
            p_lon, p_lat = coords[0], coords[1]
            d_lat = (p_lat - lat) * 111000
            d_lon = (p_lon - lon) * 111000 * 0.99
            dist = (d_lat**2 + d_lon**2) ** 0.5

            if dist <= radius_m:
                category = props.get("category", "poi")
                fallback_pois.append({
                    "id": feature.get("id"),
                    "lat": p_lat,
                    "lon": p_lon,
                    "name": props.get("name", "สถานที่สำคัญ"),
                    "category": category,
                    "type": category,
                    "tags": {
                        "name": props.get("name"),
                        category: category,
                        "description": props.get("description", ""),
                        "badge": props.get("badge", "")
                    }
                })

        logger.info(f"Loaded {len(fallback_pois)} fallback landmarks within {radius_m}m")
        return fallback_pois
    except Exception as e:
        logger.error(f"Error loading fallback landmarks: {e}")
        return []

@router.get(
    "/overpass",
    status_code=status.HTTP_200_OK,
    summary="Fetch POIs around coordinate from Overpass API (with resilient fallback)",
    description="Queries OpenStreetMap Overpass API server-side with valid User-Agent. Falls back to curated landmarks if Overpass is unreachable."
)
async def get_pois_around(
    lat: float = Query(default=7.0084, description="Latitude of the center point"),
    lon: float = Query(default=100.4767, description="Longitude of the center point"),
    radius: int = Query(default=1500, description="Search radius in meters (default 1500m)")
) -> List[Dict[str, Any]]:
    cache_key = f"{round(lat, 3)}_{round(lon, 3)}_{radius}"
    if cache_key in _poi_cache:
        logger.info(f"Returning cached POIs for {cache_key}")
        return _poi_cache[cache_key]

    query = f"""[out:json][timeout:4];
(
  node["amenity"~"hospital|school|university|marketplace"](around:{radius},{lat},{lon});
  node["shop"~"mall|supermarket"](around:{radius},{lat},{lon});
);
out body 25;"""

    pois: List[Dict[str, Any]] = []

    # Attempt Overpass API servers (fast timeout: 3.5 seconds each)
    for server in OVERPASS_SERVERS:
        try:
            async with httpx.AsyncClient(timeout=3.5) as client:
                resp = await client.post(
                    server,
                    data={"data": query},
                    headers={
                        "User-Agent": USER_AGENT,
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                )

            if resp.status_code == 200:
                data = resp.json()
                elements = data.get("elements", [])
                for el in elements:
                    tags = el.get("tags", {})
                    name = tags.get("name")
                    if not name:
                        continue
                    amenity = tags.get("amenity")
                    shop = tags.get("shop")
                    category = amenity or shop or "poi"
                    poi_type = "amenity" if amenity else ("shop" if shop else "poi")

                    pois.append({
                        "id": el.get("id"),
                        "lat": el.get("lat"),
                        "lon": el.get("lon"),
                        "name": name,
                        "category": category,
                        "type": poi_type,
                        "tags": tags
                    })

                if pois:
                    logger.info(f"Successfully fetched {len(pois)} POIs from Overpass ({server})")
                    break
        except Exception as e:
            logger.warning(f"Overpass query to {server} timed out or failed: {e}")

    # If Overpass is offline, timed out, or returned 0 items: use local curated landmarks
    if not pois:
        logger.info("Overpass returned 0 items or timed out. Falling back to curated landmarks.")
        pois = _get_fallback_landmarks(lat, lon, max(float(radius), 4000.0))

    if pois:
        _poi_cache[cache_key] = pois

    return pois
