import logging
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, status
from app.services.queue import get_redis_pool

router = APIRouter()
logger = logging.getLogger(__name__)

class RadarDetectRequest(BaseModel):
    latitude: float = Field(..., description="Latitude of clicked / inspected point")
    longitude: float = Field(..., description="Longitude of clicked / inspected point")
    radius_meters: Optional[float] = Field(200.0, description="Radar scan radius in meters (default 200m)")
    conf_threshold: Optional[float] = Field(0.25, description="YOLO confidence threshold (default 0.25)")

@router.post(
    "/radar-detect",
    summary="Detect buildings within 200m using YOLOv8 best.pt and appraise target building",
    description="Captures satellite imagery around (latitude, longitude), runs YOLOv8 model from MinIO to detect all buildings in 200m, identifies target building, and calculates zone appraisal value."
)
async def scan_radar_vision(req: RadarDetectRequest) -> Dict[str, Any]:
    pool = await get_redis_pool()
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis pool unavailable for AI Worker inference."
        )

    try:
        job = await pool.enqueue_job(
            "radar_vision_detect",
            latitude=req.latitude,
            longitude=req.longitude,
            radius_meters=req.radius_meters or 200.0,
            conf_threshold=req.conf_threshold or 0.25,
        )
        logger.info(f"Enqueued vision radar job: {job.job_id} for ({req.latitude}, {req.longitude})")
        result = await job.result(timeout=25.0)
        return result
    except Exception as e:
        logger.error(f"Error during AI vision radar detection: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Vision detection failed: {str(e)}"
        )
