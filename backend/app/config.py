import os
from typing import Optional

class Settings:
    PROJECT_NAME: str = "GeoPrice AI API"
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

    # JWT & Security
    SECRET_KEY: str = os.getenv(
        "SECRET_KEY", 
        "geoprice-super-secret-jwt-key-change-in-production-2026"
    )
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

    # MinIO S3 Object Storage
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "minio:9000")
    MINIO_ROOT_USER: str = os.getenv("MINIO_ROOT_USER", "admin")
    MINIO_ROOT_PASSWORD: str = os.getenv("MINIO_ROOT_PASSWORD", "password123")
    MINIO_SECURE: bool = os.getenv("MINIO_SECURE", "false").lower() in ("true", "1", "yes")

settings = Settings()
