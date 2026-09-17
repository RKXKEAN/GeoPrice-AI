import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.job import Job
from app.models.assessment import RiskAssessment
from app.schemas.webhook import WebhookResultRequest, WebhookResultResponse

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post(
    "/results",
    response_model=WebhookResultResponse,
    summary="Update assessment results (Internal Webhook)",
    description="Internal endpoint called by the AI Worker to update job status and persist inferred risk assessment data."
)
def update_assessment_results(
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

        # If completed, create or update RiskAssessment record
        if payload.status == "completed":
            assessment = db.query(RiskAssessment).filter(RiskAssessment.job_id == job.job_id).first()
            if assessment:
                assessment.risk_level = payload.risk_level or "moderate"
                assessment.score = payload.score if payload.score is not None else 0.5
                assessment.details_json = payload.details
            else:
                assessment = RiskAssessment(
                    job_id=job.job_id,
                    location_id=job.location_id,
                    risk_level=payload.risk_level or "moderate",
                    score=payload.score if payload.score is not None else 0.5,
                    details_json=payload.details
                )
                db.add(assessment)

        db.commit()
        logger.info(f"Updated job {job.job_id} to status '{job.status}' via webhook.")
        
        return WebhookResultResponse(
            status="success",
            message="Job status and assessment results saved successfully.",
            job_id=job.job_id
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to process webhook for job {payload.job_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal database error: {str(e)}"
        )
