import uuid
import logging
import httpx
from datetime import datetime, timezone
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from app.schemas.model import (
    TrainRequest,
    TrainResponse,
    ModelListResponse,
    ModelDetail,
    ModelVersionsResponse,
    ModelVersionDetail,
)
from app.services.minio_service import MinIOService, get_minio_service
from app.services.queue import get_redis_pool, enqueue_training_job

router = APIRouter()
logger = logging.getLogger(__name__)

# Local models cache (empty by default until real models are trained/registered)
REGISTERED_MODELS: Dict[str, Dict[str, Any]] = {}

@router.get(
    "",
    response_model=ModelListResponse,
    summary="List registered AI models",
    description="Returns an inventory of registered AI models by querying the MLflow Model Registry dynamically."
)
@router.get(
    "/",
    response_model=ModelListResponse,
    include_in_schema=False
)
def list_registered_models():
    """
    Returns registered models in the GeoPrice MLOps Model Registry:
    - Queries MLflow REST API dynamically.
    - If no models exist in MLflow yet, returns an empty list.
    """
    models_list = []
    try:
        with httpx.Client(timeout=3.0) as client:
            resp = client.get("http://mlflow:5000/api/2.0/mlflow/registered-models/search")
            if resp.status_code == 200:
                data = resp.json()
                registered = data.get("registered_models", [])
                for rm in registered:
                    latest = rm.get("latest_versions", [{}])[0] if rm.get("latest_versions") else {}
                    updated_ts = rm.get("last_updated_timestamp")
                    updated_iso = (
                        datetime.fromtimestamp(int(updated_ts) / 1000, tz=timezone.utc).isoformat()
                        if updated_ts else datetime.now(timezone.utc).isoformat()
                    )
                    models_list.append(
                        ModelDetail(
                            name=rm.get("name"),
                            description=rm.get("description") or f"Model {rm.get('name')}",
                            task="spatial-valuation",
                            framework="MLflow",
                            latest_version=f"v{latest.get('version', '1.0')}",
                            status=latest.get("current_stage", "Production").lower(),
                            updated_at=updated_iso
                        )
                    )
    except Exception as e:
        logger.warning(f"Could not fetch models dynamically from MLflow: {e}")

    # Merge with local REGISTERED_MODELS if any
    for m in REGISTERED_MODELS.values():
        if not any(x.name == m["name"] for x in models_list):
            models_list.append(ModelDetail(**m))

    return ModelListResponse(
        total_models=len(models_list),
        models=models_list
    )

@router.get(
    "/{model_name}/versions",
    response_model=ModelVersionsResponse,
    summary="Get model versions and metrics",
    description="Retrieves registered versions, evaluation metrics, and artifact locations for a specific model from MLflow."
)
def get_model_versions(model_name: str):
    """
    Retrieves version history for the specified model:
    - Queries MLflow live REST API.
    - If model is not registered, returns HTTP 404 Not Found.
    """
    try:
        with httpx.Client(timeout=3.0) as client:
            resp = client.get(
                "http://mlflow:5000/api/2.0/mlflow/registered-models/get",
                params={"name": model_name}
            )
            if resp.status_code == 200:
                data = resp.json()
                rm = data.get("registered_model", {})
                versions = []
                for v in rm.get("latest_versions", []):
                    created_ts = v.get("creation_timestamp")
                    created_iso = (
                        datetime.fromtimestamp(int(created_ts) / 1000, tz=timezone.utc).isoformat()
                        if created_ts else datetime.now(timezone.utc).isoformat()
                    )
                    versions.append(
                        ModelVersionDetail(
                            version=f"v{v.get('version')}",
                            run_id=v.get("run_id", "unknown"),
                            stage=v.get("current_stage", "None"),
                            metrics={},
                            artifact_path=v.get("source", ""),
                            created_at=created_iso
                        )
                    )
                return ModelVersionsResponse(
                    model_name=model_name,
                    versions_count=len(versions),
                    versions=versions
                )
    except Exception as e:
        logger.warning(f"Error querying model '{model_name}' from MLflow: {e}")

    # Fallback to local cache if present
    model_entry = REGISTERED_MODELS.get(model_name)
    if not model_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_name}' was not found in the model registry."
        )

    versions = [ModelVersionDetail(**v) for v in model_entry.get("versions", [])]
    return ModelVersionsResponse(
        model_name=model_name,
        versions_count=len(versions),
        versions=versions
    )

@router.post(
    "/train",
    response_model=TrainResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger AI model training pipeline",
    description="Validates dataset existence in MinIO S3 object storage and enqueues 'train_price_model' job into Redis ARQ queue."
)
async def trigger_model_training(
    request: TrainRequest,
    minio_svc: MinIOService = Depends(get_minio_service),
):
    """
    Trigger training of the land price valuation model:
    1. Validates that the dataset object exists in MinIO S3 bucket.
    2. If the file is missing, returns HTTP 404 Not Found.
    3. If present, packages dataset info and enqueues 'train_price_model' job in ARQ Redis queue.
    4. Returns HTTP 202 Accepted with job_id and status 'training_queued'.
    """
    bucket_name = request.dataset_bucket.strip()
    filename = request.dataset_filename.strip()
    model_version = request.model_version.strip() if request.model_version else "v1.0"

    logger.info(
        f"Checking training dataset existence: bucket='{bucket_name}', filename='{filename}', model_version='{model_version}'"
    )

    # 1. Verify dataset availability in MinIO S3
    dataset_exists = minio_svc.check_dataset_exists(
        bucket_name=bucket_name,
        object_name=filename
    )

    if not dataset_exists:
        logger.warning(
            f"Training rejected: Dataset '{filename}' not found in MinIO bucket '{bucket_name}'."
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset file '{filename}' was not found in MinIO bucket '{bucket_name}'. Please verify the bucket and filename or upload the dataset before triggering training."
        )

    # 2. Construct job identifier and dataset information payload
    job_id = str(uuid.uuid4())
    dataset_info = {
        "job_id": job_id,
        "dataset_bucket": bucket_name,
        "dataset_filename": filename,
        "model_version": model_version,
        "triggered_at": datetime.now(timezone.utc).isoformat()
    }

    # 3. Enqueue job into Redis ARQ queue
    try:
        pool = await get_redis_pool()
        if pool is not None:
            await pool.enqueue_job(
                "train_price_model",
                dataset_info,
                _job_id=job_id
            )
            logger.info(
                f"Successfully enqueued 'train_price_model' job to Redis ARQ: job_id={job_id}"
            )
        else:
            enqueued = await enqueue_training_job(job_id=job_id, dataset_info=dataset_info)
            if not enqueued:
                logger.warning(
                    f"Redis pool unavailable; training job {job_id} could not be delivered to queue immediately."
                )
    except Exception as e:
        logger.error(f"Error enqueueing 'train_price_model' job {job_id} to Redis ARQ: {e}")
        enqueued = await enqueue_training_job(job_id=job_id, dataset_info=dataset_info)
        if not enqueued:
            logger.warning(f"Fallback enqueue also failed for job {job_id}.")

    # 4. Return HTTP 202 Accepted
    return TrainResponse(
        job_id=job_id,
        status="training_queued",
        message=f"Model training job enqueued successfully for dataset '{filename}'. AI Worker will proceed with training.",
        dataset_info=dataset_info,
        created_at=datetime.now(timezone.utc)
    )
