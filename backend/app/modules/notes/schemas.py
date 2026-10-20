from datetime import datetime
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field, field_validator
from app.core.datetime_utils import database_utc


from app.modules.note_scheduling.schemas import NoteScheduleWrite, NoteScheduleResponse

class NoteCreate(BaseModel):
    is_private: bool = False
    calendar_schedule: NoteScheduleWrite | None = None
    request_id: Optional[UUID] = None
    title: Optional[str] = Field(default="Ghi chú mới", max_length=200)
    content: Optional[str] = Field(default="", max_length=50000)
    color: Optional[str] = Field(default="#fef08a", pattern=r"^#[0-9a-fA-F]{6}$")  # default pastel yellow
    is_pinned: Optional[bool] = False


class NoteUpdate(BaseModel):
    is_private: bool | None = None
    calendar_schedule: NoteScheduleWrite | None = None
    expected_version: int = Field(ge=0)
    title: Optional[str] = Field(default=None, max_length=200)
    content: Optional[str] = Field(default=None, max_length=50000)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    is_pinned: Optional[bool] = None
    is_archived: Optional[bool] = None


class NoteResponse(BaseModel):
    is_private: bool = False
    calendar_schedule: NoteScheduleResponse | None = None
    version: int
    id: str
    user_id: str
    title: str
    content: str
    color: str
    is_pinned: bool
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def normalize_database_timezone(cls, value: datetime) -> datetime:
        return database_utc(value)

    class Config:
        from_attributes = True


class NoteDeleteInfo(BaseModel):
    version: int
    id: str
    title: str
    has_calendar_schedule: bool
