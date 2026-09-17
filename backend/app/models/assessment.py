from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base

class RiskAssessment(Base):
    __tablename__ = "risk_assessments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True)
    risk_level = Column(String(32), nullable=False)  # e.g., low, moderate, high, extreme
    score = Column(Float, nullable=False)            # e.g., 0.0 - 1.0 or risk percentage
    details_json = Column(JSON, nullable=True)       # e.g., breakdown factors, flood depth, rainfall
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    job = relationship("Job", back_populates="assessment")
    location = relationship("Location", back_populates="assessments")
