from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

class AppraisalDatasetBase(BaseModel):
    bucket_name: str = Field(default="datasets", description="MinIO bucket name containing the dataset")
    file_name: str = Field(..., description="Unique dataset filename in MinIO")
    is_active: bool = Field(default=False, description="Whether this dataset is currently active for appraisal baseline")
    description: Optional[str] = Field(default=None, description="Optional description of the appraisal dataset")

class AppraisalDatasetCreate(AppraisalDatasetBase):
    pass

class AppraisalDatasetUpdate(BaseModel):
    bucket_name: Optional[str] = Field(default=None, description="MinIO bucket name containing the dataset")
    file_name: Optional[str] = Field(default=None, description="Unique dataset filename in MinIO")
    is_active: Optional[bool] = Field(default=None, description="Active status flag")
    description: Optional[str] = Field(default=None, description="Optional description")

class AppraisalDatasetResponse(AppraisalDatasetBase):
    id: int = Field(..., description="Unique dataset ID")
    created_at: datetime = Field(..., description="Creation timestamp")

    model_config = {"from_attributes": True}
