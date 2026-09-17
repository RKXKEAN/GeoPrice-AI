from sqlalchemy import Column, Integer, String, Float, DateTime, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base

class LandPlot(Base):
    __tablename__ = "land_plots"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    plot_name = Column(String(255), nullable=True, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    geometry = Column(JSON, nullable=True)  # GeoJSON polygon or boundary coordinates
    area_size_sqm = Column(Float, nullable=False)  # Plot area in square meters
    land_use_zone = Column(String(100), nullable=True)  # e.g. Orange Y.6, Commercial, Agricultural
    features = Column(JSON, nullable=True)  # Additional attributes: distance_to_transit, road_width, etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    jobs = relationship("Job", back_populates="land_plot", cascade="all, delete-orphan")
    predictions = relationship("PricePrediction", back_populates="land_plot", cascade="all, delete-orphan")
