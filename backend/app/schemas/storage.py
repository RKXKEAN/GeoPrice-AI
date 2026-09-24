from typing import Optional
from pydantic import BaseModel, Field

class StorageUploadResponse(BaseModel):
    """Schema for file upload response in storage endpoint."""
    bucket_name: str = Field(..., description="Target bucket where the file was saved")
    object_name: str = Field(..., description="Object name or key in the bucket")
    size: int = Field(..., description="Size of the uploaded file in bytes")
    content_type: str = Field(..., description="MIME content type of the uploaded file")
    etag: Optional[str] = Field(None, description="MinIO object ETag identifier")
    message: str = Field(default="File uploaded successfully", description="Status message")

class PresignedUrlResponse(BaseModel):
    """Schema for presigned download/view URL response."""
    bucket_name: str = Field(..., description="Target bucket name")
    object_name: str = Field(..., description="Object key in bucket")
    presigned_url: str = Field(..., description="Temporary presigned URL")
    expires_in_hours: int = Field(default=1, description="Validity period in hours")
