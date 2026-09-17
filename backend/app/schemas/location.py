from typing import Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field

class LocationBase(BaseModel):
    name: Optional[str] = Field(None, example="Chiang Mai Valley Area")
    latitude: float = Field(..., ge=-90.0, le=90.0, example=18.7883, description="Latitude in degrees (-90 to 90)")
    longitude: float = Field(..., ge=-180.0, le=180.0, example=98.9853, description="Longitude in degrees (-180 to 180)")
    geometry: Optional[Dict[str, Any]] = Field(None, example={"type": "Polygon", "coordinates": []})

class LocationCreate(LocationBase):
    pass

class LocationResponse(LocationBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
