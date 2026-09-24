import logging
from datetime import datetime, timezone
from typing import Dict, Any
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import get_db
from app.services.queue import get_redis_pool
from app.services.minio_service import MinIOService, get_minio_service

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get(
    "",
    status_code=status.HTTP_200_OK,
    summary="Basic Health Check",
    description="Returns high-level availability status of the GeoPrice AI backend service."
)
@router.get(
    "/",
    status_code=status.HTTP_200_OK,
    include_in_schema=False
)
def basic_health_check():
    """Returns basic service health status."""
    return {
        "status": "ok",
        "message": "GeoPrice API is running"
    }

@router.get(
    "/detailed",
    status_code=status.HTTP_200_OK,
    summary="Detailed Dependency Health Check",
    description="Inspects real-time connectivity to PostgreSQL Database, Redis ARQ Queue, and MinIO S3 Object Storage."
)
async def detailed_health_check(
    db: Session = Depends(get_db),
    minio_svc: MinIOService = Depends(get_minio_service)
):
    """
    Performs active health probes against backing services:
    - PostgreSQL: executes 'SELECT 1' ping.
    - Redis ARQ: checks ping response on the Redis connection pool.
    - MinIO S3: checks connection by verifying bucket existence.
    """
    services_status: Dict[str, str] = {
        "database": "disconnected",
        "redis": "disconnected",
        "minio": "disconnected"
    }

    # 1. Probe Database
    try:
        db.execute(text("SELECT 1"))
        services_status["database"] = "connected"
    except Exception as e:
        logger.warning(f"Database health probe failed: {e}")
        services_status["database"] = "disconnected"

    # 2. Probe Redis
    try:
        pool = await get_redis_pool()
        if pool is not None:
            # arq redis pool check
            await pool.ping()
            services_status["redis"] = "connected"
        else:
            services_status["redis"] = "disconnected"
    except Exception as e:
        logger.warning(f"Redis health probe failed: {e}")
        services_status["redis"] = "disconnected"

    # 3. Probe MinIO
    try:
        # Check if MinIO client can reach server
        minio_svc.client.bucket_exists("datasets")
        services_status["minio"] = "connected"
    except Exception as e:
        logger.warning(f"MinIO health probe failed: {e}")
        services_status["minio"] = "disconnected"

    overall_healthy = all(v == "connected" for v in services_status.values())

    return {
        "status": "healthy" if overall_healthy else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": services_status
    }
