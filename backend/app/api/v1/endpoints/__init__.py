from app.api.v1.endpoints.predictions import router as predictions_router
from app.api.v1.endpoints.webhook import router as webhook_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.models import router as models_router
from app.api.v1.endpoints.storage import router as storage_router
from app.api.v1.endpoints.data import router as data_router
from app.api.v1.endpoints.annotation import router as annotation_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.monitoring import router as monitoring_router

__all__ = [
    "predictions_router",
    "webhook_router",
    "auth_router",
    "models_router",
    "storage_router",
    "data_router",
    "annotation_router",
    "health_router",
    "monitoring_router",
]
