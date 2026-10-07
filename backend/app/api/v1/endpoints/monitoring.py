import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, status
from app.schemas.monitoring import PredictionFeedback, FeedbackResponse

router = APIRouter()
logger = logging.getLogger(__name__)

# Temporary in-memory storage for feedbacks (simulated database persistence)
FEEDBACK_STORE = []

@router.post(
    "/feedback",
    response_model=FeedbackResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit user valuation feedback",
    description="Collects user feedback, valuation rating ('too_high', 'too_low', 'reasonable'), and ground truth comments for MLOps model performance monitoring and drift detection."
)
async def submit_prediction_feedback(
    feedback: PredictionFeedback
):
    """
    Receives and records evaluation feedback from domain analysts or clients:
    - job_id: Identifier of the valuation request.
    - rating: 'too_high' | 'too_low' | 'reasonable'
    - expected_price: Optional actual market or appraised price.
    - comment: Qualitative remarks.
    """
    feedback_id = str(uuid.uuid4())
    record = {
        "feedback_id": feedback_id,
        "job_id": feedback.job_id,
        "rating": feedback.rating,
        "expected_price": feedback.expected_price,
        "comment": feedback.comment,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    FEEDBACK_STORE.append(record)

    # Persist in Redis
    try:
        import json
        from app.services.queue import get_redis_pool
        pool = await get_redis_pool()
        if pool is not None:
            await pool.rpush("geoprice_user_feedbacks", json.dumps(record))
    except Exception as e:
        logger.warning(f"Could not persist feedback to Redis: {e}")

    # Persist in MinIO datasets/user_price_feedbacks.csv
    try:
        import io, csv
        from app.services.minio_service import get_minio_service
        minio_svc = get_minio_service()
        existing_lines = ""
        try:
            res = minio_svc.client.get_object("datasets", "user_price_feedbacks.csv")
            existing_lines = res.read().decode("utf-8")
        except Exception:
            pass

        fieldnames = ["feedback_id", "job_id", "rating", "expected_price", "comment", "created_at"]
        output = io.StringIO()
        if not existing_lines:
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerow(record)
            all_csv = output.getvalue().encode("utf-8")
        else:
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writerow(record)
            all_csv = (existing_lines.rstrip() + "\n" + output.getvalue()).encode("utf-8")

        minio_svc.client.put_object("datasets", "user_price_feedbacks.csv", io.BytesIO(all_csv), length=len(all_csv), content_type="text/csv")
        logger.info(f"Persisted user price feedback {feedback_id} to MinIO 'datasets/user_price_feedbacks.csv'")
    except Exception as e:
        logger.warning(f"Could not persist feedback to MinIO: {e}")

    logger.info(
        f"Recorded prediction feedback {feedback_id} for job {feedback.job_id}: rating='{feedback.rating}', expected={feedback.expected_price}"
    )

    return FeedbackResponse(
        message="Feedback received successfully. Thank you.",
        feedback_id=feedback_id,
        submitted_at=datetime.now(timezone.utc)
    )

@router.get(
    "/feedback",
    summary="List all user valuation feedbacks",
    description="Returns recorded feedbacks from users for model evaluation and admin review."
)
async def get_prediction_feedbacks():
    try:
        import json
        from app.services.queue import get_redis_pool
        pool = await get_redis_pool()
        if pool is not None:
            raw_list = await pool.lrange("geoprice_user_feedbacks", 0, -1)
            if raw_list:
                return [json.loads(item.decode("utf-8")) for item in reversed(raw_list)]
    except Exception as e:
        logger.warning(f"Could not read feedbacks from Redis: {e}")

    return list(reversed(FEEDBACK_STORE))

