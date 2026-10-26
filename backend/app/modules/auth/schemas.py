from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Optional


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    full_name: str
    role: str
    department: str
    job_title: Optional[str] = None
    employee_code: Optional[str] = None
    phone: Optional[str] = None
    office_location: Optional[str] = None
    position_id: Optional[str] = None
    work_location_id: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    allowed_apps: Optional[str] = "bookingreports,workflows,itam"
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=30)
    job_title: Optional[str] = Field(default=None, max_length=100)
    office_location: Optional[str] = Field(default=None, max_length=150)
    position_id: Optional[str] = None
    work_location_id: Optional[str] = None
    bio: Optional[str] = Field(default=None, max_length=10000)

    @field_validator('full_name', 'phone', 'job_title', 'office_location', 'bio', mode='before')
    @classmethod
    def trimmed(cls, value):
        return value.strip() if isinstance(value, str) else value


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse
