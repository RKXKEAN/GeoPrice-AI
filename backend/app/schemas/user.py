import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from app.models.user import UserRole

class UserBase(BaseModel):
    email: str = Field(
        ...,
        pattern=r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$",
        example="researcher@geoprice.ai",
        description="Valid user email address"
    )

class UserCreate(UserBase):
    password: str = Field(..., min_length=6, example="SecretPassword123!", description="Account password (min 6 characters)")
    role: UserRole = Field(default=UserRole.USER, description="User role ('user' or 'admin')")

class UserResponse(UserBase):
    id: uuid.UUID = Field(..., description="Unique user UUID")
    role: UserRole = Field(..., description="User role permission")
    is_active: bool = Field(..., description="Active status")
    created_at: datetime = Field(..., description="Account creation timestamp")

    model_config = {"from_attributes": True}
