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

    # Initialize ARQ Redis Pool
    try:
        await get_redis_pool()
    except Exception as e:
        logger.warning(f"Could not connect to Redis pool during startup: {e}")

    yield

    # Teardown / Graceful Shutdown
    logger.info("Shutting down GeoPrice AI Backend API...")
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