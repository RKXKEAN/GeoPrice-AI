import logging
from fastapi import APIRouter, Depends, Query, HTTPException, status
from app.services.minio_service import MinIOService, get_minio_service
from app.schemas.data import DatasetListResponse, DatasetItem

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get(
    "/datasets",
    response_model=DatasetListResponse,
    summary="List available datasets for AI training",
    description="Fetches all dataset files (e.g. .csv, .geojson, .zip) residing in the MinIO 'datasets' bucket for Data Scientists and training triggers."
)
def list_training_datasets(
    bucket_name: str = Query(default="datasets", description="MinIO bucket containing datasets"),
    recursive: bool = Query(default=True, description="Whether to scan recursively"),
    minio_svc: MinIOService = Depends(get_minio_service)
):
    """
    Retrieves dataset inventory from MinIO S3:
    1. Scans the specified bucket using MinIOService.list_objects.
    2. Packages file metadata (name, size, timestamp, ETag).
    3. Returns list and total count for Data Scientist review.
    """
    try:
        objects = minio_svc.list_objects(bucket_name=bucket_name, recursive=recursive)
        dataset_items = [DatasetItem(**obj) for obj in objects]
        return DatasetListResponse(
            bucket_name=bucket_name,
            total_count=len(dataset_items),
            datasets=dataset_items
        )
    except Exception as e:
        logger.error(f"Failed to retrieve dataset listing from bucket '{bucket_name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to query datasets from MinIO: {str(e)}"
        )
