from app.api.v1.endpoints.predictions import router as predictions_router
from app.api.v1.endpoints.webhook import router as webhook_router
from app.api.v1.endpoints.auth import router as auth_router

__all__ = ["predictions_router", "webhook_router", "auth_router"]
