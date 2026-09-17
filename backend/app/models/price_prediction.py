from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON
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

    # Relationships
    job = relationship("Job", back_populates="prediction")
    land_plot = relationship("LandPlot", back_populates="predictions")
