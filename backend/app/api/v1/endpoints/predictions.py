import uuid
import logging
import asyncio
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models.land_plot import LandPlot
from app.models.job import Job
from app.schemas.prediction import (
    PredictionRequest,
    PredictionResponse,
    PredictionResultResponse,
    PricePredictionDetailResponse,
)
from app.schemas.land_plot import LandPlotResponse
from app.services.queue import enqueue_prediction_job

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post(
    "",
    response_model=PredictionResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit land plot for AI price valuation",
    description="Records the land plot details and enqueues an asynchronous price prediction task for the AI Worker."
)
async def create_price_prediction(
    request: PredictionRequest,
    db: Session = Depends(get_db)
):
    try:
        # 1. Create LandPlot record
        land_plot = LandPlot(
            plot_name=request.plot_name,
            latitude=request.latitude,
            longitude=request.longitude,
            geometry=request.geometry,
            area_size_sqm=request.area_size_sqm,
            land_use_zone=request.land_use_zone,
            features=request.features
        )
        db.add(land_plot)
        db.flush()  # Populates land_plot.id

        # 2. Create Job record
        job_id = str(uuid.uuid4())
        job = Job(
            job_id=job_id,
            plot_id=land_plot.id,
            status="pending"
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        # 3. Enqueue task to Redis for ARQ AI Worker
        enqueued = await enqueue_prediction_job(
            job_id=job_id,
            plot_id=land_plot.id,
            area_size_sqm=land_plot.area_size_sqm,
            features=land_plot.features
        )
        
        if not enqueued:
            logger.warning(f"Job {job_id} created in DB but failed to enqueue to Redis.")

        return PredictionResponse(
            job_id=job.job_id,
            status=job.status,
            message="Land price prediction job enqueued successfully. AI valuation model is running.",
            created_at=job.created_at
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create price prediction job: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initiate valuation job: {str(e)}"
        )

@router.get(
    "/{job_id}",
    response_model=PredictionResultResponse,
    summary="Get land price prediction status and result",
    description="Retrieves the current execution status and predicted valuation figures (if completed) for the given job_id."
)
def get_prediction_status(
    job_id: str,
    db: Session = Depends(get_db)
):
    job = db.query(Job).filter(Job.job_id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prediction job with ID '{job_id}' was not found."
        )

    # Format land plot response
    plot_data = None
    if job.land_plot:
        plot_data = LandPlotResponse.model_validate(job.land_plot)

    # Format price prediction response if available
    prediction_data = None
    if job.prediction:
        prediction_data = PricePredictionDetailResponse.model_validate(job.prediction)

    return PredictionResultResponse(
        job_id=job.job_id,
        status=job.status,
        error_message=job.error_message,
        land_plot=plot_data,
        price_prediction=prediction_data,
        created_at=job.created_at,
        updated_at=job.updated_at
    )


@router.websocket("/ws/{job_id}")
async def websocket_prediction_status(
    websocket: WebSocket,
    job_id: str,
):
    """
    Real-time WebSocket endpoint for tracking prediction job status.
    Polls the database every 1 second and sends results as soon as the status is completed or failed.
    """
    await websocket.accept()
    session = SessionLocal()
    try:
        while True:
            session.expire_all()
            job = session.get(Job, job_id)
            if not job:
                await websocket.send_json({
                    "status": "not_found",
                    "error_message": f"Prediction job with ID '{job_id}' was not found."
                })
                break

            if job.status in ("completed", "failed"):
                plot_data = None
                if job.land_plot:
                    plot_data = LandPlotResponse.model_validate(job.land_plot).model_dump(mode="json")

                prediction_data = None
                if job.prediction:
                    prediction_data = PricePredictionDetailResponse.model_validate(job.prediction).model_dump(mode="json")

                response_payload = {
                    "job_id": job.job_id,
                    "status": job.status,
                    "error_message": job.error_message,
                    "land_plot": plot_data,
                    "price_prediction": prediction_data,
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                    "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                }
                await websocket.send_json(response_payload)
                break
            else:
                await websocket.send_json({
                    "job_id": job.job_id,
                    "status": job.status,
                    "message": "AI valuation model is processing..."
                })

            await asyncio.sleep(1)
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected for job {job_id}")
    except Exception as e:
        logger.error(f"WebSocket error for job {job_id}: {e}")
        try:
            await websocket.send_json({"status": "error", "error_message": str(e)})
        except Exception:
            pass
    finally:
        session.close()
        try:
            await websocket.close()
        except Exception:
            pass
