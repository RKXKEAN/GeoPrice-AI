from typing import Optional
from pydantic import BaseModel, Field

class Token(BaseModel):
    access_token: str = Field(..., description="JWT Bearer access token")
    token_type: str = Field("bearer", description="Token type")

class TokenData(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
