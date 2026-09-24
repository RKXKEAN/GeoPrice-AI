from fastapi import APIRouter
from app.api.v1.endpoints.predictions import router as predictions_router
from app.api.v1.endpoints.webhook import router as webhook_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints import models, storage, data, annotation, health, monitoring

api_v1_router = APIRouter()
api_router = api_v1_router

# Authentication & RBAC endpoints
api_router.include_router(
    auth_router,
    prefix="/auth",
    tags=["Authentication"]
)

# Land Price Prediction endpoints
api_router.include_router(
    predictions_router,
    prefix="/predictions",
    tags=["Land Price Predictions"]
)

# Storage Management endpoints (MinIO S3)
api_router.include_router(
    storage.router,
    prefix="/storage",
    tags=["Storage"]
)

# Data Management endpoints (Datasets in MinIO)
api_router.include_router(
    data.router,
    prefix="/data",
    tags=["Data Management"]
)

# Data Annotation endpoints (Label Studio)
api_router.include_router(
    annotation.router,
    prefix="/annotation",
    tags=["Annotation"]
)

# AI Models & Registry endpoints (MLflow & ARQ Training)
api_router.include_router(
    models.router,
    prefix="/models",
    tags=["Models"]
)

# Health Check & Service Probes endpoints
api_router.include_router(
    health.router,
    prefix="/health",
    tags=["Health"]
)

# MLOps Monitoring & Model Feedback endpoints
api_router.include_router(
    monitoring.router,
    prefix="/monitoring",
    tags=["Monitoring"]
)

# Internal Webhook endpoints
api_router.include_router(
    webhook_router,
    prefix="/internal/webhook",
    tags=["Internal Webhook"]
)
