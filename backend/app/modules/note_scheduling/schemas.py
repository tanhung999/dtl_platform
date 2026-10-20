"""Hợp đồng lịch hẹn của ghi chú ."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, model_validator

class NoteScheduleWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starts_at: datetime
    ends_at: datetime
    is_all_day: bool = False
    event_id: str | None = None
    expected_updated_at: datetime | None = None

    @model_validator(mode="after")
    def validate_schedule(self):
        from app.modules.calendar.schemas import EventWrite
        validated = EventWrite(title="Ghi chú", starts_at=self.starts_at, ends_at=self.ends_at, is_all_day=self.is_all_day)
        self.starts_at, self.ends_at = validated.starts_at, validated.ends_at
        if bool(self.event_id) != bool(self.expected_updated_at):
            raise ValueError("Cần mã và phiên bản lịch hẹn khi sửa.")
        if self.expected_updated_at is not None and self.expected_updated_at.tzinfo is None:
            raise ValueError("Phiên bản lịch hẹn phải kèm múi giờ.")
        return self

class NoteScheduleResponse(BaseModel):
    event_id: str
    starts_at: datetime
    ends_at: datetime
    is_all_day: bool
    expected_updated_at: datetime
