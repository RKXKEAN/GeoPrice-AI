import uuid
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base

class Job(Base):
    __tablename__ = "jobs"

    job_id = Column(String(36), primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    plot_id = Column(Integer, ForeignKey("land_plots.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="pending", index=True)  # pending, processing, completed, failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    land_plot = relationship("LandPlot", back_populates="jobs")
    prediction = relationship("PricePrediction", back_populates="job", uselist=False, cascade="all, delete-orphan")
