from app.api.v1.endpoints.assessments import router as assessments_router
from app.api.v1.endpoints.webhook import router as webhook_router
from app.api.v1.endpoints.auth import router as auth_router

__all__ = ["assessments_router", "webhook_router", "auth_router"]
