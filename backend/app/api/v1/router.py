from fastapi import APIRouter
from app.api.v1.endpoints.assessments import router as assessments_router
from app.api.v1.endpoints.webhook import router as webhook_router
from app.api.v1.endpoints.auth import router as auth_router

api_v1_router = APIRouter()

# Authentication & RBAC endpoints
api_v1_router.include_router(
    auth_router,
    prefix="/auth",
    tags=["Authentication"]
)

# Public Assessment endpoints
api_v1_router.include_router(
    assessments_router,
    prefix="/assessments",
    tags=["Assessments"]
)

# Internal Webhook endpoints
api_v1_router.include_router(
    webhook_router,
    prefix="/internal/webhook",
    tags=["Internal Webhook"]
)
