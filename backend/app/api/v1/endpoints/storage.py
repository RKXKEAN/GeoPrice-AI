import logging
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, Query, HTTPException, status
from app.services.minio_service import MinIOService, get_minio_service
from app.schemas.storage import StorageUploadResponse, PresignedUrlResponse

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post(
    "/upload",
    response_model=StorageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload file to MinIO Object Storage",
    description="Uploads an arbitrary file (e.g. satellite image, GeoTIFF, boundary dataset) directly to a specified MinIO bucket."
)
async def upload_file_to_storage(
    file: UploadFile = File(..., description="The binary file to upload"),
    bucket_name: str = Form(default="images", description="Target MinIO bucket (e.g. 'images', 'datasets')"),
    object_name: Optional[str] = Form(default=None, description="Custom object key/filename. Defaults to original filename."),
    minio_svc: MinIOService = Depends(get_minio_service)
):
    """
    Accepts multipart file upload and saves it to MinIO S3 storage:
    1. Reads uploaded file content stream.
    2. Auto-creates bucket if it does not yet exist.
    3. Saves file with specified or original filename.
    4. Returns metadata including bucket, object name, byte size, and ETag.
    """
    target_object_name = object_name.strip() if object_name else file.filename
    if not target_object_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename could not be determined. Please specify 'object_name'."
        )

    try:
        file_bytes = await file.read()
        result = minio_svc.upload_file(
            bucket_name=bucket_name,
            object_name=target_object_name,
            file_data=file_bytes,
            content_type=file.content_type or "application/octet-stream"
        )
        return StorageUploadResponse(
            bucket_name=result["bucket_name"],
            object_name=result["object_name"],
            size=result["size"],
            content_type=result["content_type"],
            etag=result.get("etag"),
            message=f"File '{target_object_name}' uploaded successfully to bucket '{bucket_name}'."
        )
    except Exception as e:
        logger.error(f"Failed to upload file '{target_object_name}' to MinIO: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}"
        )
    finally:
        await file.close()

@router.get(
    "/presigned-url",
    response_model=PresignedUrlResponse,
    summary="Generate temporary presigned URL for MinIO object",
    description="Creates a time-limited presigned GET URL for viewing or downloading an object stored in MinIO."
)
def get_object_presigned_url(
    bucket_name: str = Query(..., description="Target MinIO bucket (e.g. 'datasets', 'images')"),
    object_name: str = Query(..., description="Object name/path in the bucket"),
    expires_hours: int = Query(default=1, ge=1, le=168, description="URL expiration time in hours (1-168)"),
    minio_svc: MinIOService = Depends(get_minio_service)
):
    """
    Generates a presigned GET URL:
    1. Verifies that the requested object exists in the bucket.
    2. If missing, returns HTTP 404 Not Found.
    3. If present, generates signed URL with specified expiration.
    """
    exists = minio_svc.check_dataset_exists(bucket_name=bucket_name, object_name=object_name)
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Object '{object_name}' not found in MinIO bucket '{bucket_name}'."
        )

    try:
        url = minio_svc.get_presigned_url(
            bucket_name=bucket_name,
            object_name=object_name,
            expires_hours=expires_hours
        )
        return PresignedUrlResponse(
            bucket_name=bucket_name,
            object_name=object_name,
            presigned_url=url,
            expires_in_hours=expires_hours
        )
    except Exception as e:
        logger.error(f"Failed to generate presigned URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not generate presigned URL: {str(e)}"
        )
