from typing import Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.land_plot import LandPlotResponse

class PredictionRequest(BaseModel):
    plot_name: Optional[str] = Field(None, example="แปลงที่ดินทองหล่อ ซอย 10", description="Plot name or landmark")
    latitude: float = Field(..., ge=-90.0, le=90.0, example=13.7314, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, example=100.5812, description="Longitude in decimal degrees")
    geometry: Optional[Dict[str, Any]] = Field(None, example={"type": "Polygon", "coordinates": []}, description="GeoJSON polygon boundaries")
    area_size_sqm: float = Field(..., gt=0.0, example=1600.0, description="Plot size in square meters")
    land_use_zone: Optional[str] = Field(None, example="สีส้ม ย.6", description="Town planning zone")
    features: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        example={"distance_to_bts_m": 350, "road_width_m": 12.0},
        description="Spatial attributes affecting valuation"
    )

class PredictionResponse(BaseModel):
    job_id: str = Field(..., description="Unique UUID tracking the price prediction task")
    status: str = Field("pending", description="Task execution status: pending, processing, completed, failed")
    message: str = Field("Price prediction job enqueued successfully. AI Worker is evaluating land valuation.")
    created_at: datetime

    model_config = {"from_attributes": True}

class PricePredictionDetailResponse(BaseModel):
    id: int
    predicted_price_per_sqm: float = Field(..., example=325000.0, description="Estimated price per square meter (THB)")
    total_predicted_price: float = Field(..., example=520000000.0, description="Total estimated plot valuation (THB)")
    confidence_score: float = Field(..., example=0.92, description="Confidence interval / score (0.0 - 1.0)")
    model_version: Optional[str] = Field("geoprice-xgb-v1.0", description="AI model version used for inference")
    details_json: Optional[Dict[str, Any]] = Field(None, description="Valuation factors and market comparables")
    created_at: datetime

    model_config = {"from_attributes": True}

class PredictionResultResponse(BaseModel):
    job_id: str
    status: str = Field(..., description="Job status: pending, processing, completed, failed")
    error_message: Optional[str] = None
    land_plot: Optional[LandPlotResponse] = None
    price_prediction: Optional[PricePredictionDetailResponse] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
