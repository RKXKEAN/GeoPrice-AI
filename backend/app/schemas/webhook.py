from typing import Optional, Any, Dict
from pydantic import BaseModel, Field

class WebhookResultRequest(BaseModel):
    job_id: str = Field(..., description="Target assessment job ID")
    status: str = Field("completed", description="Task execution status: completed or failed")
    risk_level: Optional[str] = Field("moderate", description="Assessed risk level: low, moderate, high, extreme")
    score: Optional[float] = Field(0.5, ge=0.0, description="Risk score or probability index")
    details: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Detailed inference results or metadata")
    error_message: Optional[str] = Field(None, description="Error explanation if task execution failed")

class WebhookResultResponse(BaseModel):
    status: str = Field("success", description="Status of the webhook processing")
    message: str = Field("Job status and risk assessment updated successfully")
    job_id: str
