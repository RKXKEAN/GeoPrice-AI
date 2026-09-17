from typing import Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.location import LocationResponse

class AssessmentRequest(BaseModel):
    location_name: Optional[str] = Field(None, example="Chiang Mai Valley Area", description="Descriptive name of the area")
    latitude: float = Field(..., ge=-90.0, le=90.0, example=18.7883, description="Latitude (-90 to 90)")
    longitude: float = Field(..., ge=-180.0, le=180.0, example=98.9853, description="Longitude (-180 to 180)")
    geometry: Optional[Dict[str, Any]] = Field(None, example={"type": "Polygon", "coordinates": []}, description="GeoJSON polygon or boundary")
    image_name: Optional[str] = Field("sentinel2_sample.tif", description="Target imagery filename in MinIO or source storage")

class AssessmentResponse(BaseModel):
    job_id: str = Field(..., description="Unique UUID tracking the assessment job")
    status: str = Field("pending", description="Current status of the job (pending, processing, completed, failed)")
    message: str = Field("Assessment job enqueued successfully and is waiting for AI processing.")
    created_at: datetime

    model_config = {"from_attributes": True}

class RiskAssessmentDetailResponse(BaseModel):
    id: int
    risk_level: str = Field(..., example="moderate", description="Calculated risk level (e.g. low, moderate, high, extreme)")
    score: float = Field(..., example=0.68, description="Risk score or probability index")
    details_json: Optional[Dict[str, Any]] = Field(None, description="Detailed analysis metadata (rainfall, slope, simulated depth)")
    created_at: datetime

    model_config = {"from_attributes": True}

class AssessmentResultResponse(BaseModel):
    job_id: str
    status: str = Field(..., description="Job status: pending, processing, completed, failed")
    error_message: Optional[str] = None
    location: Optional[LocationResponse] = None
    risk_assessment: Optional[RiskAssessmentDetailResponse] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
