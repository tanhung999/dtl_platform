from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict, field_validator
from .schemas import EventWrite


class EventInteraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starts_at: datetime
    ends_at: datetime
    is_all_day: bool
    expected_updated_at: datetime

    @field_validator("starts_at", "ends_at", "expected_updated_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("Thời gian phải kèm múi giờ.")
        return value.astimezone(timezone.utc)

    def validate_event(self, event):
        return EventWrite(title=event.title, description=event.description, location=event.location, color=event.color,
                          starts_at=self.starts_at, ends_at=self.ends_at, is_all_day=self.is_all_day)
