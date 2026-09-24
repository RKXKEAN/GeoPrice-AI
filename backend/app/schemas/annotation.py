from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field

class LabelStudioProject(BaseModel):
    """Schema representing an annotation project from Label Studio."""
    id: int = Field(..., description="Project unique ID")
    title: str = Field(..., description="Project title")
    description: Optional[str] = Field(None, description="Project description")
    task_number: int = Field(default=0, description="Total number of annotation tasks")
    finished_task_number: int = Field(default=0, description="Number of completed tasks")
    label_config: Optional[str] = Field(None, description="XML labeling configuration")
    created_at: Optional[str] = Field(None, description="Creation timestamp")

class AnnotationProjectsResponse(BaseModel):
    """Response schema for Label Studio projects inquiry."""
    status: str = Field(..., description="'connected' (live) or 'scaffold_mode' (fallback mock)")
    source: str = Field(..., description="Data source indicator")
    message: Optional[str] = Field(None, description="Status or descriptive notice")
    total: int = Field(..., description="Total count of projects")
    projects: List[Dict[str, Any]] = Field(..., description="List of Label Studio projects")
