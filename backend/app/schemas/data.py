from typing import List, Optional
from pydantic import BaseModel, Field

class DatasetItem(BaseModel):
    """Metadata item representing a dataset file in MinIO."""
    object_name: str = Field(..., description="Filename or object key of the dataset in S3")
    size: int = Field(..., description="File size in bytes")
    last_modified: Optional[str] = Field(None, description="Last modification timestamp (ISO format)")
    etag: Optional[str] = Field(None, description="MinIO ETag hash")
    is_dir: bool = Field(default=False, description="Flag indicating if the object is a prefix/directory")

class DatasetListResponse(BaseModel):
    """Response schema for listing available datasets."""
    bucket_name: str = Field(default="datasets", description="Bucket name queried")
    total_count: int = Field(..., description="Total number of dataset objects found")
    datasets: List[DatasetItem] = Field(..., description="List of dataset files ready for model training")
