from fastapi import APIRouter
from app.api.v1.endpoints.predictions import router as predictions_router
from app.api.v1.endpoints.webhook import router as webhook_router
from app.api.v1.endpoints.auth import router as auth_router

api_v1_router = APIRouter()

# Authentication & RBAC endpoints
api_v1_router.include_router(
    auth_router,
    prefix="/auth",
    tags=["Authentication"]
)

# Land Price Prediction endpoints
api_v1_router.include_router(
    predictions_router,
    prefix="/predictions",
    tags=["Land Price Predictions"]
)

# Internal Webhook endpoints
api_v1_router.include_router(
    webhook_router,
    prefix="/internal/webhook",
    tags=["Internal Webhook"]
)
