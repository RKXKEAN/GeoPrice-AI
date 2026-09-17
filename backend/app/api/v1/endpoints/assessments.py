import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.location import Location
from app.models.job import Job
from app.models.assessment import RiskAssessment
from app.schemas.assessment import (
    AssessmentRequest,
    AssessmentResponse,
    AssessmentResultResponse,
    RiskAssessmentDetailResponse,
)
from app.schemas.location import LocationResponse
from app.services.queue import enqueue_assessment_job

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post(
    "",
    response_model=AssessmentResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit assessment request",
    description="Accepts location coordinates, records the job in PostgreSQL, and enqueues the task to Redis for the ARQ AI Worker."
)
async def create_assessment(
    request: AssessmentRequest,
    db: Session = Depends(get_db)
):
    try:
        # 1. Create Location record
        location = Location(
            name=request.location_name,
            latitude=request.latitude,
            longitude=request.longitude,
            geometry=request.geometry
        )
        db.add(location)
        db.flush()  # Populates location.id

        # 2. Create Job record
        job_id = str(uuid.uuid4())
        job = Job(
            job_id=job_id,
            location_id=location.id,
            status="pending"
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        # 3. Enqueue task to Redis for ARQ AI Worker
        image_name = request.image_name or "sentinel2_sample.tif"
        enqueued = await enqueue_assessment_job(
            job_id=job_id,
            location_id=location.id,
            image_name=image_name
        )
        
        if not enqueued:
            logger.warning(f"Job {job_id} created in DB but failed to enqueue to Redis.")

        return AssessmentResponse(
            job_id=job.job_id,
            status=job.status,
            message="Assessment job enqueued successfully. AI Worker will process the risk model asynchronously.",
            created_at=job.created_at
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create assessment job: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initiate assessment job: {str(e)}"
        )

@router.get(
    "/{job_id}",
    response_model=AssessmentResultResponse,
    summary="Get assessment status and results",
    description="Retrieves the current execution status and risk assessment details (if completed) for the given job_id."
)
def get_assessment_status(
    job_id: str,
    db: Session = Depends(get_db)
):
    job = db.query(Job).filter(Job.job_id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Assessment job with ID '{job_id}' was not found."
        )

    # Format location response
    location_data = None
    if job.location:
        location_data = LocationResponse.model_validate(job.location)

    # Format risk assessment response if available
    risk_assessment_data = None
    if job.assessment:
        risk_assessment_data = RiskAssessmentDetailResponse.model_validate(job.assessment)

    return AssessmentResultResponse(
        job_id=job.job_id,
        status=job.status,
        error_message=job.error_message,
        location=location_data,
        risk_assessment=risk_assessment_data,
        created_at=job.created_at,
        updated_at=job.updated_at
    )
