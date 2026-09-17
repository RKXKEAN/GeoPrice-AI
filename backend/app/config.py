import os
from typing import Optional

class Settings:
    PROJECT_NAME: str = "HydroGeo AI API"
    API_V1_STR: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://admin:password123@postgres:5432/hydrogeo_db"
    )
    
    # Redis for ARQ
    REDIS_URL: str = os.getenv(
        "REDIS_URL", 
        "redis://redis:6379"
    )

settings = Settings()
