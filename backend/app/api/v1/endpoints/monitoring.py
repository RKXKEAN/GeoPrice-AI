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

    logger.info(
        f"Recorded prediction feedback {feedback_id} for job {feedback.job_id}: rating='{feedback.rating}', expected={feedback.expected_price}"
    )

    return FeedbackResponse(
        message="Feedback received successfully. Thank you.",
        feedback_id=feedback_id,
        submitted_at=datetime.now(timezone.utc)
    )
