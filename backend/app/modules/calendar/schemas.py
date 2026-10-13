from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CALENDAR_TIMEZONE = timezone(timedelta(hours=7))


class EventWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    location: str = Field(default="", max_length=255)
    starts_at: datetime
    ends_at: datetime
    is_all_day: bool = False
    color: str = Field(default="#2563eb", pattern=r"^#[0-9a-fA-F]{6}$")

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
        if self.is_all_day:
            for value in (self.starts_at, self.ends_at):
                local = value.astimezone(CALENDAR_TIMEZONE)
                if (local.hour, local.minute, local.second, local.microsecond) != (0, 0, 0, 0):
                    raise ValueError("Sự kiện cả ngày phải bắt đầu và kết thúc lúc 00:00 (UTC+7).")
        return self


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    title: str
    description: str
    location: str
    starts_at: datetime
    ends_at: datetime
    is_all_day: bool
    color: str
    created_at: datetime
    updated_at: datetime

    @field_validator("starts_at", "ends_at", "created_at", "updated_at")
    @classmethod
    def normalize_database_timezone(cls, value: datetime) -> datetime:
        # SQLite returns naive timestamps for UTC values; PostgreSQL preserves tzinfo.
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
