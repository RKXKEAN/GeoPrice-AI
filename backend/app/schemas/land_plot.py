from typing import Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field

class LandPlotBase(BaseModel):
    plot_name: Optional[str] = Field(None, example="แปลงที่ดินทองหล่อ ซอย 10", description="Name or identifier of the land plot")
    latitude: float = Field(..., ge=-90.0, le=90.0, example=13.7314, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, example=100.5812, description="Longitude in decimal degrees")
    geometry: Optional[Dict[str, Any]] = Field(None, example={"type": "Polygon", "coordinates": []}, description="GeoJSON polygon boundaries")
    area_size_sqm: float = Field(..., gt=0.0, example=1600.0, description="Land area in square meters (1 Rai = 1600 sqm)")
    land_use_zone: Optional[str] = Field(None, example="สีส้ม ย.6", description="Town planning land-use zoning")
    features: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        example={"distance_to_bts_m": 350, "road_width_m": 12.0, "corner_plot": True},
        description="Auxiliary spatial and physical attributes"
    )

class LandPlotCreate(LandPlotBase):
    pass

class LandPlotUpdate(BaseModel):
    plot_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    geometry: Optional[Dict[str, Any]] = None
    area_size_sqm: Optional[float] = None
    land_use_zone: Optional[str] = None
    features: Optional[Dict[str, Any]] = None

class LandPlotResponse(LandPlotBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
