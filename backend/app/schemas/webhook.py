from typing import Optional, Any, Dict
from pydantic import BaseModel, Field

class WebhookResultRequest(BaseModel):
    job_id: str = Field(..., description="Target prediction job ID")
    status: str = Field("completed", description="Task execution status: completed or failed")
    predicted_price_per_sqm: Optional[float] = Field(None, description="Valuation price per square meter in THB")
    total_predicted_price: Optional[float] = Field(None, description="Total valuation price in THB")
    confidence_score: Optional[float] = Field(0.9, ge=0.0, le=1.0, description="Confidence score")
    model_version: Optional[str] = Field("geoprice-xgb-v1.0", description="Model version identifier")
    details: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Detailed valuation breakdown factors")
    error_message: Optional[str] = Field(None, description="Error explanation if task execution failed")

class WebhookResultResponse(BaseModel):
    status: str = Field("success", description="Status of the webhook processing")
    message: str = Field("Job status and price prediction updated successfully")
    job_id: str
