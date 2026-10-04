from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base

class PricePrediction(Base):
    __tablename__ = "price_predictions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    plot_id = Column(Integer, ForeignKey("land_plots.id", ondelete="CASCADE"), nullable=False, index=True)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    predicted_price_per_sqm = Column(Float, nullable=False)  # Predicted price in THB per sq.m.
    total_predicted_price = Column(Float, nullable=False)    # Total valuation (per_sqm * area_size_sqm)
    confidence_score = Column(Float, nullable=False)         # Model confidence level (0.0 - 1.0)
    model_version = Column(String(50), nullable=True, default="geoprice-xgb-v1.0")
    details_json = Column(JSON, nullable=True)               # Valuation breakdown factors
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Multi-State Versioning Ecosystem
    raw_image_url = Column(String(500), nullable=True)       # MinIO satellite tile key

    # State 1: Initial YOLO + OpenCV extraction & initial price prediction
    initial_bboxes = Column(JSON, nullable=True)             # Raw YOLO detection bboxes
    initial_polygons = Column(JSON, nullable=True)           # Stage 2 contour vertices & roof area
    initial_price_prediction = Column(Float, nullable=True)  # Initial estimated price (THB)
    target_prediction_year = Column(Integer, nullable=True, default=2026)

    # State 2: Human-in-the-loop (HITL) Re-labeled / Corrected
    corrected_bboxes = Column(JSON, nullable=True)           # Admin corrected bboxes
    recalculated_polygons = Column(JSON, nullable=True)      # Recalculated OpenCV polygon & net area
    recalculated_price = Column(Float, nullable=True)        # Price recalculated with corrected area
    is_verified = Column(Boolean, nullable=False, default=False, index=True)

    # State 3: Ground Truth Evaluation & Retraining Trigger
    actual_market_price = Column(Float, nullable=True)       # Official Treasury / Land Dept appraisal
    actual_recorded_at = Column(DateTime(timezone=True), nullable=True)
    error_metrics = Column(JSON, nullable=True)              # Error comparison (diff, mape, etc.)

    # Relationships
    job = relationship("Job", back_populates="prediction")
    land_plot = relationship("LandPlot", back_populates="predictions")

