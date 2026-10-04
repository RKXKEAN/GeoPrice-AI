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

QUEUE_INFERENCE = "arq:queue_inference"
QUEUE_TRAINING = "arq:queue_training"

async def enqueue_inference_job(
    function_name: str,
    *args: Any,
    _job_id: Optional[str] = None,
    **kwargs: Any
):
    """
    Enqueues a high-priority interactive inference task directly into the inference worker queue.
    """
    pool = await get_redis_pool()
    if pool is None:
        logger.warning(f"Could not enqueue inference job {function_name}: Redis pool unavailable.")
        return None
    
    return await pool.enqueue_job(
        function_name,
        *args,
        _job_id=_job_id,
        _queue_name=QUEUE_INFERENCE,
        **kwargs
    )

async def enqueue_training_task(
    function_name: str,
    *args: Any,
    _job_id: Optional[str] = None,
    **kwargs: Any
):
    """
    Enqueues a heavy background training / batch auto-labeling task into the dedicated trainer queue.
    """
    pool = await get_redis_pool()
    if pool is None:
        logger.warning(f"Could not enqueue training task {function_name}: Redis pool unavailable.")
        return None

    return await pool.enqueue_job(
        function_name,
        *args,
        _job_id=_job_id,
        _queue_name=QUEUE_TRAINING,
        **kwargs
    )

async def enqueue_prediction_job(
    job_id: str,
    plot_id: int,
    area_size_sqm: float,
    features: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Enqueues a land price prediction task into Redis for the ARQ AI Worker (Inference Queue).
    Passes job_id, plot_id, area_size_sqm, and spatial features to 'predict_land_price'.
    """
    try:
        job = await enqueue_inference_job(
            "predict_land_price",
            plot_id=plot_id,
            area_size_sqm=area_size_sqm,
            features=features or {},
            job_id=job_id,
            _job_id=job_id
        )
        if job is None:
            return False
        logger.info(f"Enqueued ARQ job for price prediction on inference queue: job_id={job_id}, arq_job={job}")
        return True
    except Exception as e:
        logger.error(f"Error enqueueing job {job_id} to Redis ARQ inference queue: {e}")
        return False

async def enqueue_training_job(
    job_id: str,
    dataset_info: Dict[str, Any]
) -> bool:
    """
    Enqueues a model training task into Redis for the ARQ AI Worker (Training Queue).
    Passes dataset_info to 'train_price_model'.
    """
    try:
        job = await enqueue_training_task(
            "train_price_model",
            dataset_info,
            _job_id=job_id
        )
        if job is None:
            return False
        logger.info(f"Enqueued ARQ job for price model training on training queue: job_id={job_id}, arq_job={job}")
        return True
    except Exception as e:
        logger.error(f"Error enqueueing training job {job_id} to Redis ARQ training queue: {e}")
        return False


