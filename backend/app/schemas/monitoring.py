from datetime import datetime, timezone
from typing import Optional, Literal
from pydantic import BaseModel, Field

class PredictionFeedback(BaseModel):
    """Schema for user land valuation feedback and model drift monitoring."""
    job_id: str = Field(..., description="Unique job ID of the evaluated land price prediction")
    rating: Literal["too_high", "too_low", "reasonable"] = Field(
        ...,
        description="Subjective rating of valuation accuracy: 'too_high', 'too_low', or 'reasonable'"
    )
    expected_price: Optional[float] = Field(
        None,
        ge=0,
        description="Optional expected market price (THB) based on user or local appraisal knowledge"
    )
    comment: Optional[str] = Field(
        None,
        description="Optional descriptive comments or field observations"
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "job_id": "c7a8b411-d009-43c7-a85c-4d5ff1a0937a",
                "rating": "reasonable",
                "expected_price": 552000000.0,
                "comment": "Accurate estimate matching official land department table."
            }
        }
    }

class FeedbackResponse(BaseModel):
    """Response schema upon successfully receiving feedback."""
    message: str = Field(
        default="Feedback received successfully. Thank you.",
        description="Acknowledgment message"
    )
    feedback_id: Optional[str] = Field(None, description="Unique tracking identifier for the feedback submission")
    submitted_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp of submission"
    )
