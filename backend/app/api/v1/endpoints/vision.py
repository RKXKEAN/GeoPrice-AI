import logging
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.land_plot import LandPlot
from app.models.job import Job
from app.models.price_prediction import PricePrediction
from app.services.queue import get_redis_pool, QUEUE_INFERENCE

router = APIRouter()
logger = logging.getLogger(__name__)

class RadarDetectRequest(BaseModel):
    latitude: float = Field(..., description="Latitude of clicked / inspected point")
    longitude: float = Field(..., description="Longitude of clicked / inspected point")
    radius_meters: Optional[float] = Field(200.0, description="Radar scan radius in meters (default 200m)")
    conf_threshold: Optional[float] = Field(0.25, description="YOLO confidence threshold (default 0.25)")

@router.post(
    "/radar-detect",
    summary="Detect buildings within 200m using YOLO-test and appraise target building",
    description="Captures satellite imagery around (latitude, longitude), runs YOLO-test model from MinIO to detect all buildings in 200m, identifies target building, and calculates zone appraisal value."
)
async def scan_radar_vision(
    req: RadarDetectRequest,
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    pool = await get_redis_pool()
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis pool unavailable for AI Worker inference."
        )

    try:
        job = await pool.enqueue_job(
            "radar_vision_detect",
            latitude=req.latitude,
            longitude=req.longitude,
            radius_meters=req.radius_meters or 200.0,
            conf_threshold=req.conf_threshold or 0.25,
            _queue_name=QUEUE_INFERENCE,
        )
        logger.info(f"Enqueued vision radar job: {job.job_id} for ({req.latitude}, {req.longitude})")
        result = await job.result(timeout=25.0)

        # Multi-State Database Ecosystem: Persist State 1 (Initial Prediction)
        try:
            target_data = result.get("target_building", {})
            user_trigger = result.get("user_trigger", {}) or {}
            radar_sum = result.get("radar_summary", {})

            land_plot = LandPlot(
                plot_name=target_data.get("parcel_name") or f"AOI Radar Scan ({req.latitude:.4f}, {req.longitude:.4f})",
                latitude=req.latitude,
                longitude=req.longitude,
                geometry={"type": "Polygon", "coordinates": [target_data.get("coordinates", [])]} if target_data.get("coordinates") else None,
                area_size_sqm=float(target_data.get("area_sqm") or 100.0),
                land_use_zone=radar_sum.get("zone_name"),
                features={
                    "road_name": radar_sum.get("road_name"),
                    "density_level": radar_sum.get("density_level"),
                    "total_buildings_detected": radar_sum.get("total_buildings_detected", 0),
                    "valuation_source": radar_sum.get("valuation_source"),
                    "parcel_id": target_data.get("parcel_id"),
                    "detection_method": target_data.get("method"),
                }
            )
            db.add(land_plot)
            db.flush()

            job_record = Job(
                job_id=job.job_id,
                plot_id=land_plot.id,
                status="completed"
            )
            db.add(job_record)

            raw_img_key = user_trigger.get("raw_image_url") or (f"user_triggers/{job.job_id}.jpg" if job.job_id else None)
            price_pred = PricePrediction(
                plot_id=land_plot.id,
                job_id=job.job_id,
                predicted_price_per_sqm=float(target_data.get("price_per_sqm") or (target_data.get("price_per_wah", 0) / 4.0)),
                total_predicted_price=float(target_data.get("total_estimated_price") or 0.0),
                confidence_score=float(target_data.get("confidence") or 0.90),
                model_version=radar_sum.get("valuation_source") or "geoprice-hybrid-vision-v1",
                details_json=radar_sum,
                raw_image_url=raw_img_key,
                initial_bboxes=result.get("surrounding_buildings"),
                initial_polygons={
                    "coordinates": target_data.get("coordinates"),
                    "area_sqm": target_data.get("area_sqm"),
                    "shape_type": target_data.get("shape_type", "polygon"),
                    "normalized_polygon": target_data.get("normalized_polygon"),
                    "target_box_normalized": target_data.get("target_box_normalized"),
                },
                initial_price_prediction=float(target_data.get("total_estimated_price") or 0.0),
                target_prediction_year=2026,
                is_verified=False
            )
            db.add(price_pred)
            db.commit()

            result["prediction_id"] = price_pred.id
            result["job_id"] = job.job_id
            result["db_saved"] = True
            logger.info(f"Persisted State 1 record into DB: prediction_id={price_pred.id}")
        except Exception as db_err:
            logger.warning(f"Could not persist State 1 record: {db_err}")
            db.rollback()

        return result
    except Exception as e:
        logger.error(f"Error during AI vision radar detection: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Vision detection failed: {str(e)}"
        )

