from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base

class AppraisalDataset(Base):
    __tablename__ = "appraisal_datasets"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    bucket_name = Column(String(255), default="datasets", nullable=False)
    file_name = Column(String(255), unique=True, index=True, nullable=False)
    is_active = Column(Boolean, default=False, nullable=False, index=True)
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
