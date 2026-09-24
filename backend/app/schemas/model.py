from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field

class TrainRequest(BaseModel):
    """Schema for triggering model training on a dataset stored in MinIO S3."""
    dataset_bucket: str = Field(
        default="datasets",
        description="Name of the MinIO S3 bucket containing the dataset"
    )
    dataset_filename: str = Field(
        ...,
        description="Filename or object key of dataset in MinIO (e.g. 'hatyai_land_prices.csv' or 'dataset.zip')"
    )
    model_version: Optional[str] = Field(
        default="v1.0",
        description="Version identifier/tag for the model to be trained"
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "dataset_bucket": "datasets",
                "dataset_filename": "hatyai_land_prices.csv",
                "model_version": "v1.0"
            }
        }
    }

class TrainResponse(BaseModel):
    """Schema for response when training job is accepted and queued."""
    job_id: str = Field(..., description="Unique job identifier in the Redis ARQ queue")
    status: str = Field(default="training_queued", description="Status of the training job")
    message: str = Field(..., description="Descriptive status message")
    dataset_info: Dict[str, Any] = Field(..., description="Dataset and model training parameters")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp when the job was queued"
    )

class ModelDetail(BaseModel):
    """Metadata representing a registered AI model in the model registry."""
    name: str = Field(..., description="Registered model identifier")
    description: str = Field(..., description="Model description and purpose")
    task: str = Field(..., description="Machine learning task type")
    framework: str = Field(..., description="Framework used (e.g. XGBoost, PyTorch)")
    latest_version: str = Field(..., description="Latest available version tag")
    status: str = Field(default="production", description="Model lifecycle stage")
    updated_at: str = Field(..., description="Timestamp of latest modification")

class ModelListResponse(BaseModel):
    """Response schema for listing registered AI models."""
    total_models: int = Field(..., description="Total count of registered models")
    models: List[ModelDetail] = Field(..., description="Registered models list")

class ModelVersionDetail(BaseModel):
    """Metadata representing a specific version of a model."""
    version: str = Field(..., description="Version identifier")
    run_id: str = Field(..., description="Associated MLflow experiment run ID")
    stage: str = Field(..., description="Deployment stage: Production, Staging, or Archived")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="Validation metrics (R2, RMSE, MAE)")
    artifact_path: str = Field(..., description="MinIO S3 storage location for model artifacts")
    created_at: str = Field(..., description="Timestamp of version creation")

class ModelVersionsResponse(BaseModel):
    """Response schema for model version query."""
    model_name: str = Field(..., description="Name of the queried model")
    versions_count: int = Field(..., description="Total versions found")
    versions: List[ModelVersionDetail] = Field(..., description="List of version details")
