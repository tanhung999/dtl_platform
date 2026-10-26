from app.modules.notifications.reminder_fields import ReminderFields
from datetime import datetime, timedelta, timezone
from uuid import UUID
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


CALENDAR_TIMEZONE = timezone(timedelta(hours=7))


class EventWrite(ReminderFields):
    model_config = ConfigDict(extra="forbid")

    recurrence: Literal["NONE", "DAILY", "WEEKLY"] = "NONE"
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    location: str = Field(default="", max_length=255)
    starts_at: datetime
    ends_at: datetime
    is_private: bool = False
    is_all_day: bool = False
    color: str = Field(default="#2563eb", pattern=r"^#[0-9a-fA-F]{6}$")
    follower_ids: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("title", "description", "location", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("starts_at", "ends_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Thời gian phải kèm múi giờ.")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def validate_range(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Thời gian kết thúc phải sau thời gian bắt đầu.")
        if not self.is_all_day and self.recurrence != 'NONE' and self.ends_at - self.starts_at > timedelta(days=1):
            raise ValueError('Mỗi lần lặp chỉ được kéo dài tối đa một ngày. Hãy chọn lại giờ kết thúc.')
        if self.is_all_day:
            for value in (self.starts_at, self.ends_at):
                local = value.astimezone(CALENDAR_TIMEZONE)
                if (local.hour, local.minute, local.second, local.microsecond) != (0, 0, 0, 0):
                    raise ValueError("Sự kiện cả ngày phải bắt đầu và kết thúc lúc 00:00 (UTC+7).")
        return self


class EventResponse(BaseModel):
    recurrence: Literal["NONE", "DAILY", "WEEKLY"] = "NONE"
    series_id: str | None = None
    series_recurrence: Literal["DAILY", "WEEKLY"] | None = None
    deletion_includes_series: bool = False
    recurrence_until: datetime | None = None
    reminder_minutes: int | None = None
    reminder_at: datetime | None = None
    scheduled_note_id: str | None = None
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    title: str
    description: str
    location: str
    starts_at: datetime
    ends_at: datetime
    is_private: bool = False
    is_all_day: bool
    color: str
    created_at: datetime
    updated_at: datetime
    followers: list[dict] = []
    is_following: bool = False
    can_edit: bool = False
    can_delete: bool = False
    owner: dict | None = None

    @field_validator("starts_at", "ends_at", "created_at", "updated_at")
    @classmethod
    def normalize_database_timezone(cls, value: datetime) -> datetime:
        # SQLite returns naive timestamps for UTC values; PostgreSQL preserves tzinfo.
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class EventCreate(EventWrite):
    client_request_id: UUID | None = None


class EventUpdate(EventWrite):
    follower_ids: list[str] | None = Field(default=None, max_length=100)
    expected_updated_at: datetime

    @field_validator("expected_updated_at")
    @classmethod
    def require_expected_timezone(cls, value):
        if value.tzinfo is None:
            raise ValueError("Phiên bản sự kiện phải kèm múi giờ.")
        return value.astimezone(timezone.utc)
