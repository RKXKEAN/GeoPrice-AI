import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.job import Job
from app.models.price_prediction import PricePrediction
from app.schemas.webhook import WebhookResultRequest, WebhookResultResponse

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post(
    "/results",
    response_model=WebhookResultResponse,
    summary="Update price prediction results (Internal Webhook)",
    description="Internal callback endpoint for the AI Worker to report predicted valuation figures and complete the job."
)
def update_prediction_results(
    payload: WebhookResultRequest,
    db: Session = Depends(get_db)
):
    job = db.query(Job).filter(Job.job_id == payload.job_id).first()
    if not job:
        logger.warning(f"Webhook received for non-existent job: {payload.job_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job with ID '{payload.job_id}' not found."
        )

    try:
        # Update Job status and any error messages
        job.status = payload.status
        if payload.error_message:
            job.error_message = payload.error_message

        # If completed, create or update PricePrediction record
        if payload.status == "completed":
            prediction = db.query(PricePrediction).filter(PricePrediction.job_id == job.job_id).first()
            
            # Default calculations if values are omitted
            sqm_price = payload.predicted_price_per_sqm or 250000.0
            area = job.land_plot.area_size_sqm if job.land_plot else 1600.0
            total_price = payload.total_predicted_price or (sqm_price * area)
            confidence = payload.confidence_score if payload.confidence_score is not None else 0.90
            version = payload.model_version or "geoprice-xgb-v1.0"

            if prediction:
                prediction.predicted_price_per_sqm = sqm_price
                prediction.total_predicted_price = total_price
                prediction.confidence_score = confidence
                prediction.model_version = version
                prediction.details_json = payload.details
            else:
                prediction = PricePrediction(
                    job_id=job.job_id,
                    plot_id=job.plot_id,
                    predicted_price_per_sqm=sqm_price,
                    total_predicted_price=total_price,
                    confidence_score=confidence,
                    model_version=version,
                    details_json=payload.details
                )
                db.add(prediction)

        db.commit()
        logger.info(f"Updated job {job.job_id} to status '{job.status}' with land price prediction.")
        
        return WebhookResultResponse(
            status="success",
            message="Job status and land price prediction saved successfully.",
            job_id=job.job_id
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to process webhook for job {payload.job_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal database error: {str(e)}"
        )
