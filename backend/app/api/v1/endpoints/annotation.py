import os
import logging
import httpx
from fastapi import APIRouter, status
from app.schemas.annotation import AnnotationProjectsResponse

router = APIRouter()
logger = logging.getLogger(__name__)

LABEL_STUDIO_URL = os.getenv("LABEL_STUDIO_URL", "http://label_studio:8080")
LABEL_STUDIO_API_KEY = os.getenv("LABEL_STUDIO_API_KEY", "")
LABEL_STUDIO_USERNAME = os.getenv("LABEL_STUDIO_USERNAME", "admin@geoprice.ai")
LABEL_STUDIO_PASSWORD = os.getenv("LABEL_STUDIO_PASSWORD", "password123")

# Predefined scaffold projects used when live Label Studio is not yet authenticated
SCAFFOLD_PROJECTS = [
    {
        "id": 1,
        "title": "Hat Yai Satellite Cadastral Annotation",
        "description": "Satellite parcel polygon segmentation dataset and boundary polygon annotation.",
        "task_number": 600,
        "finished_task_number": 450,
        "label_config": "<View><Image name=\"image\" value=\"$image\"/><PolygonLabels name=\"tag\" toName=\"image\"><Label value=\"LandPlot\" background=\"#00f2fe\"/><Label value=\"Building\" background=\"#f59e0b\"/></PolygonLabels></View>",
        "created_at": "2026-09-20T08:00:00.000Z"
    },
    {
        "id": 2,
        "title": "Songkhla Lake Shoreline & Waterbody Masking",
        "description": "Spatial buffer feature annotation for hydrological and flood zone factors.",
        "task_number": 150,
        "finished_task_number": 120,
        "label_config": "<View><Image name=\"image\" value=\"$image\"/><BrushLabels name=\"tag\" toName=\"image\"><Label value=\"WaterBody\" background=\"#3b82f6\"/></BrushLabels></View>",
        "created_at": "2026-09-22T09:30:00.000Z"
    }
]

@router.get(
    "/projects",
    response_model=AnnotationProjectsResponse,
    status_code=status.HTTP_200_OK,
    summary="List Label Studio annotation projects",
    description="Connects to Label Studio REST API to retrieve annotation projects, or returns scaffold data if API credentials are not yet configured."
)
async def list_annotation_projects():
    """
    Scaffold / Proxy Endpoint for Label Studio:
    1. Attempts to connect to Label Studio via httpx.AsyncClient at http://label_studio:8080/api/projects/.
    2. Sends Token or Basic Auth header if configured in environment.
    3. If live API succeeds with 200 OK, returns real project records.
    4. If unauthenticated, unreachable, or in development mode, catches error and returns scaffold mock projects.
    """
    headers = {"Host": "localhost:8080"}
    if LABEL_STUDIO_API_KEY:
        headers["Authorization"] = f"Token {LABEL_STUDIO_API_KEY}"

    auth = None
    if not LABEL_STUDIO_API_KEY and LABEL_STUDIO_USERNAME and LABEL_STUDIO_PASSWORD:
        auth = httpx.BasicAuth(LABEL_STUDIO_USERNAME, LABEL_STUDIO_PASSWORD)

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.get(
                f"{LABEL_STUDIO_URL}/api/projects/",
                headers=headers,
                auth=auth
            )
            if response.status_code == 200:
                data = response.json()
                project_list = data.get("results", data) if isinstance(data, dict) else data
                logger.info(f"Successfully fetched {len(project_list)} projects from live Label Studio.")
                return AnnotationProjectsResponse(
                    status="connected",
                    source="label_studio_live",
                    message="Connected to Label Studio live instance.",
                    total=len(project_list),
                    projects=project_list
                )
            else:
                logger.warning(
                    f"Label Studio returned status {response.status_code}. Using scaffold project data."
                )
    except Exception as e:
        logger.warning(f"Could not reach Label Studio directly at {LABEL_STUDIO_URL}: {e}. Falling back to scaffold.")

    # Fallback scaffold response
    return AnnotationProjectsResponse(
        status="scaffold_mode",
        source="mock_scaffold",
        message="Label Studio is in scaffold mode. Configure LABEL_STUDIO_API_KEY for live data synchronization.",
        total=len(SCAFFOLD_PROJECTS),
        projects=SCAFFOLD_PROJECTS
    )
