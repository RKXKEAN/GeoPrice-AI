import os
import json
import time
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from app.services.queue import get_redis_pool, enqueue_training_task, QUEUE_TRAINING

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 24 * 3600  # 24 Hours (86,400 seconds)
CHECK_INTERVAL = 30           # Evaluate loop every 30 seconds
REDIS_KEY_LAST_TIME = "geoprice:last_vision_retrain_time"
REDIS_KEY_STATE = "geoprice:vision_scheduler_state"

_scheduler_task: Optional[asyncio.Task] = None


async def get_vision_scheduler_status() -> Dict[str, Any]:
    """Retrieves current 24-hour vision scheduler state and countdown."""
    pool = await get_redis_pool()
    now_ts = time.time()
    
    if pool is None:
        return {
            "enabled": True,
            "interval_hours": 24,
            "seconds_remaining": INTERVAL_SECONDS,
            "hours_remaining": 24.0,
            "next_run_iso": datetime.fromtimestamp(now_ts + INTERVAL_SECONDS, tz=timezone.utc).isoformat(),
            "last_run_iso": datetime.fromtimestamp(now_ts, tz=timezone.utc).isoformat(),
            "mode": "Full-Auto (ไม่รอคำสั่งมนุษย์)",
            "target_model": "YOLOv8 Bounding Box (Vision Model)",
            "status": "ready"
        }

    raw_state = await pool.get(REDIS_KEY_STATE)
    if raw_state:
        try:
            state = json.loads(raw_state.decode("utf-8"))
            last_ts = state.get("last_run_timestamp", now_ts)
            elapsed = now_ts - last_ts
            remaining = max(0.0, INTERVAL_SECONDS - elapsed)
            state["seconds_remaining"] = int(remaining)
            state["hours_remaining"] = round(remaining / 3600.0, 2)
            return state
        except Exception:
            pass

    # Default if state not cached yet
    last_raw = await pool.get(REDIS_KEY_LAST_TIME)
    last_ts = float(last_raw.decode("utf-8")) if last_raw else now_ts
    elapsed = now_ts - last_ts
    remaining = max(0.0, INTERVAL_SECONDS - elapsed)
    
    return {
        "enabled": True,
        "interval_hours": 24,
        "seconds_remaining": int(remaining),
        "hours_remaining": round(remaining / 3600.0, 2),
        "last_run_timestamp": last_ts,
        "last_run_iso": datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat(),
        "next_run_timestamp": last_ts + INTERVAL_SECONDS,
        "next_run_iso": datetime.fromtimestamp(last_ts + INTERVAL_SECONDS, tz=timezone.utc).isoformat(),
        "mode": "Full-Auto (ไม่รอคำสั่งมนุษย์)",
        "target_model": "YOLOv8 Bounding Box (Vision Model)",
        "status": "waiting"
    }


async def record_vision_retrain_executed(job_id: str):
    """Resets the 24-hour cycle timer when a retrain job is dispatched."""
    pool = await get_redis_pool()
    now_ts = time.time()
    if pool is not None:
        try:
            await pool.set(REDIS_KEY_LAST_TIME, str(now_ts))
            next_run_dt = datetime.fromtimestamp(now_ts + INTERVAL_SECONDS, tz=timezone.utc)
            state = {
                "enabled": True,
                "interval_hours": 24,
                "interval_seconds": INTERVAL_SECONDS,
                "last_run_timestamp": now_ts,
                "last_run_iso": datetime.fromtimestamp(now_ts, tz=timezone.utc).isoformat(),
                "next_run_timestamp": now_ts + INTERVAL_SECONDS,
                "next_run_iso": next_run_dt.isoformat(),
                "seconds_remaining": INTERVAL_SECONDS,
                "hours_remaining": 24.0,
                "last_job_id": job_id,
                "mode": "Full-Auto (ไม่รอคำสั่งมนุษย์)",
                "target_model": "YOLOv8 Bounding Box (Vision Model)",
                "status": "waiting"
            }
            await pool.set(REDIS_KEY_STATE, json.dumps(state))
            logger.info(f"🔄 [Vision 24h Scheduler] Timer reset for next 24 hours. Next run at: {next_run_dt.isoformat()}")
        except Exception as e:
            logger.warning(f"Could not record retrain timestamp in Redis: {e}")


async def run_vision_scheduler_loop():
    """Continuous background loop monitoring the 24-hour automated vision retrain schedule."""
    logger.info("🛰️ [Vision 24h Scheduler] Starting autonomous 24-hour scheduler for Vision Model (Full-Auto, 0 human intervention)...")
    
    # Initial setup
    pool = await get_redis_pool()
    now_ts = time.time()
    last_ts = now_ts
    
    if pool is not None:
        try:
            last_raw = await pool.get(REDIS_KEY_LAST_TIME)
            if not last_raw:
                await pool.set(REDIS_KEY_LAST_TIME, str(now_ts))
                logger.info(f"🛰️ [Vision 24h Scheduler] Initialized cycle baseline timestamp: {now_ts}")
            else:
                last_ts = float(last_raw.decode("utf-8"))
        except Exception as e:
            logger.warning(f"Error accessing Redis on scheduler init: {e}")

    while True:
        try:
            await asyncio.sleep(CHECK_INTERVAL)
            now_ts = time.time()
            pool = await get_redis_pool()
            if pool is None:
                continue

            last_raw = await pool.get(REDIS_KEY_LAST_TIME)
            if last_raw:
                try:
                    last_ts = float(last_raw.decode("utf-8"))
                except Exception:
                    pass

            elapsed = now_ts - last_ts
            remaining = max(0.0, INTERVAL_SECONDS - elapsed)
            next_run_dt = datetime.fromtimestamp(last_ts + INTERVAL_SECONDS, tz=timezone.utc)

            # Keep live state cached
            state_data = {
                "enabled": True,
                "interval_hours": 24,
                "interval_seconds": INTERVAL_SECONDS,
                "last_run_timestamp": last_ts,
                "last_run_iso": datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat(),
                "next_run_timestamp": last_ts + INTERVAL_SECONDS,
                "next_run_iso": next_run_dt.isoformat(),
                "seconds_remaining": int(remaining),
                "hours_remaining": round(remaining / 3600.0, 2),
                "mode": "Full-Auto (ไม่รอคำสั่งมนุษย์)",
                "target_model": "YOLOv8 Bounding Box (Vision Model)",
                "status": "retraining" if remaining == 0 else "waiting"
            }
            await pool.set(REDIS_KEY_STATE, json.dumps(state_data))

            # 24 Hours Completed -> Trigger Retraining Immediately!
            if elapsed >= INTERVAL_SECONDS:
                job_id = f"vision-auto-24h-{int(now_ts)}"
                logger.info(
                    f"⏰ [Vision 24h Scheduler] 24 Hours elapsed ({int(elapsed)}s >= {INTERVAL_SECONDS}s)! "
                    f"Triggering automated YOLOv8 Vision Model retraining on GPU RTX 5060 (Job ID: {job_id}) without waiting for human intervention..."
                )
                
                # Advance timestamp to avoid duplicate triggers
                last_ts = now_ts
                await pool.set(REDIS_KEY_LAST_TIME, str(now_ts))
                await pool.set(f"job_status:{job_id}", "running")
                await pool.rpush(
                    f"job_logs:{job_id}",
                    f"[{datetime.now().strftime('%H:%M:%S')}] ⏰ [24h Scheduler] Automated 24-hour Vision Retraining initiated on GPU RTX 5060 (Full-Auto, 0 human intervention)."
                )

                # Dispatch directly to trainer worker queue (ALL 10 Periods = 10,000 images + User AOI, 20 epochs)
                await enqueue_training_task(
                    "retrain_vision_model",
                    dataset_period="all",
                    model_name="geoprice-yolov8-detect",
                    epochs=20,
                    force_execute=True,
                    job_id=job_id,
                    _job_id=job_id
                )
                logger.info(f"✅ [Vision 24h Scheduler] Enqueued 24h autonomous retrain job {job_id} into {QUEUE_TRAINING}")

        except asyncio.CancelledError:
            logger.info("🛑 [Vision 24h Scheduler] Loop cancelled.")
            break
        except Exception as loop_err:
            logger.error(f"⚠️ [Vision 24h Scheduler] Exception in loop: {loop_err}", exc_info=True)
            await asyncio.sleep(5)


def start_vision_scheduler() -> asyncio.Task:
    """Launches the autonomous 24h vision scheduler task."""
    global _scheduler_task
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.create_task(run_vision_scheduler_loop())
        logger.info("🚀 [Vision 24h Scheduler] Background task started successfully.")
    return _scheduler_task


def stop_vision_scheduler():
    """Cancels the vision scheduler task."""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        _scheduler_task = None
        logger.info("🛑 [Vision 24h Scheduler] Background task stopped.")
