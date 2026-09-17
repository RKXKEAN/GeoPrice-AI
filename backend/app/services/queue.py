import logging
from typing import Optional, Dict, Any
from arq import create_pool
from arq.connections import RedisSettings, ArqRedis
from app.config import settings

logger = logging.getLogger(__name__)

_redis_pool: Optional[ArqRedis] = None

async def get_redis_pool() -> Optional[ArqRedis]:
    """Returns the existing ARQ Redis pool or initializes a new one."""
    global _redis_pool
    if _redis_pool is None:
        try:
            redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
            _redis_pool = await create_pool(redis_settings)
            logger.info(f"Connected to Redis for ARQ at {settings.REDIS_URL}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis at {settings.REDIS_URL}: {e}")
            return None
    return _redis_pool

async def close_redis_pool():
    """Closes the ARQ Redis pool connection on application shutdown."""
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.close()
        _redis_pool = None
        logger.info("ARQ Redis pool closed.")

async def enqueue_prediction_job(
    job_id: str,
    plot_id: int,
    area_size_sqm: float,
    features: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Enqueues a land price prediction task into Redis for the ARQ AI Worker.
    Passes job_id, plot_id, area_size_sqm, and spatial features to 'predict_land_price'.
    """
    pool = await get_redis_pool()
    if pool is None:
        logger.warning(f"Could not enqueue job {job_id}: Redis pool is unavailable.")
        return False
    
    try:
        job = await pool.enqueue_job(
            "predict_land_price",
            plot_id=plot_id,
            area_size_sqm=area_size_sqm,
            features=features or {},
            job_id=job_id,
            _job_id=job_id
        )
        logger.info(f"Enqueued ARQ job for price prediction: job_id={job_id}, arq_job={job}")
        return True
    except Exception as e:
        logger.error(f"Error enqueueing job {job_id} to Redis ARQ: {e}")
        return False
