import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import init_db
from app.services.queue import get_redis_pool, close_redis_pool
from app.api.v1.router import api_v1_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("geoprice.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for application startup and shutdown."""
    logger.info("Starting GeoPrice AI Backend API...")
    # Initialize Database Tables
    try:
        init_db()
    except Exception as e:
        logger.error(f"Critical: Failed to initialize database: {e}")

    # Ensure MinIO Buckets
    try:
        from app.services.minio_service import minio_service
        for b in ["datasets", "images", "models", "mlflow-artifacts"]:
            minio_service.ensure_bucket_exists(b)
    except Exception as e:
        logger.warning(f"Could not verify MinIO buckets: {e}")

    # Initialize ARQ Redis Pool
    try:
        await get_redis_pool()
    except Exception as e:
        logger.warning(f"Could not connect to Redis pool during startup: {e}")

    # Launch Autonomous 24-Hour Vision Retraining Scheduler
    try:
        from app.services.vision_scheduler import start_vision_scheduler
        start_vision_scheduler()
    except Exception as e:
        logger.warning(f"Could not start vision scheduler: {e}")

    yield

    # Teardown / Graceful Shutdown
    logger.info("Shutting down GeoPrice AI Backend API...")
    try:
        from app.services.vision_scheduler import stop_vision_scheduler
        stop_vision_scheduler()
    except Exception:
        pass
    await close_redis_pool()

app = FastAPI(
    title="GeoPrice AI",
    description="API for Land Price Prediction and AI Ecosystem",
    version="0.1.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API v1 Router
app.include_router(api_v1_router, prefix=settings.API_V1_STR)