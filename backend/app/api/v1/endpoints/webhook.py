import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.job import Job
from app.models.land_plot import LandPlot
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

            # Inherit imagery and bboxes from existing prediction on the same plot or nearby coordinates or payload details
            sibling = db.query(PricePrediction)\
                .filter(PricePrediction.plot_id == job.plot_id, PricePrediction.raw_image_url.isnot(None))\
                .first()

            if not sibling and job.land_plot and job.land_plot.latitude and job.land_plot.longitude:
                lat, lon = job.land_plot.latitude, job.land_plot.longitude
                sibling = db.query(PricePrediction).join(LandPlot)\
                    .filter(
                        PricePrediction.raw_image_url.isnot(None),
                        LandPlot.latitude.between(lat - 0.005, lat + 0.005),
                        LandPlot.longitude.between(lon - 0.005, lon + 0.005)
                    ).first()

            raw_img = (sibling.raw_image_url if sibling else None) or (payload.details.get("raw_image_url") if isinstance(payload.details, dict) else None)
            init_boxes = (sibling.initial_bboxes if sibling else None) or (payload.details.get("initial_bboxes") if isinstance(payload.details, dict) else None)
            init_poly = (sibling.initial_polygons if sibling else None) or (payload.details.get("initial_polygons") if isinstance(payload.details, dict) else None)

            target_yr = int(payload.details.get("target_year") or 2026) if isinstance(payload.details, dict) else 2026
            base_sqm_val = float(payload.details.get("base_price_per_sqm_thb") or (float(payload.details.get("base_price_wah", 0)) / 4.0) or sqm_price) if isinstance(payload.details, dict) else sqm_price
            plot_area = float(job.land_plot.area_size_sqm if job.land_plot and job.land_plot.area_size_sqm else 100.0)
            base_tot_val = round(base_sqm_val * plot_area, 2)

            if prediction:
                prediction.predicted_price_per_sqm = sqm_price
                prediction.total_predicted_price = total_price
                prediction.confidence_score = confidence
                prediction.model_version = version
                prediction.details_json = payload.details
                prediction.target_prediction_year = target_yr
                prediction.base_price_current_year = base_tot_val
                prediction.base_price_per_sqm = base_sqm_val
                prediction.initial_price_prediction = total_price
                if not prediction.raw_image_url and raw_img:
                    prediction.raw_image_url = raw_img
                if not prediction.initial_bboxes and init_boxes:
                    prediction.initial_bboxes = init_boxes
                if not prediction.initial_polygons and init_poly:
                    prediction.initial_polygons = init_poly
            else:
                prediction = PricePrediction(
                    job_id=job.job_id,
                    plot_id=job.plot_id,
                    predicted_price_per_sqm=sqm_price,
                    total_predicted_price=total_price,
                    confidence_score=confidence,
                    model_version=version,
                    details_json=payload.details,
                    raw_image_url=raw_img,
                    initial_bboxes=init_boxes,
                    initial_polygons=init_poly,
                    base_price_current_year=base_tot_val,
                    base_price_per_sqm=base_sqm_val,
                    initial_price_prediction=total_price,
                    target_prediction_year=target_yr,
                    is_verified=False
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
