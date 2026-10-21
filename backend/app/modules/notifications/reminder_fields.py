"""Hợp đồng cấu hình một lần nhắc, dùng chung ba loại tài nguyên."""
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, field_validator, model_validator


class ReminderFields(BaseModel):
    reminder_minutes: Literal[0, 15, 30, 60, 1440] | None = None
    reminder_at: datetime | None = None

    @field_validator('reminder_at')
    @classmethod
    def aware_reminder(cls, value):
        if value is not None:
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError('Giờ nhắc hạn phải kèm múi giờ.')
            return value.astimezone(timezone.utc)
        return value

    @model_validator(mode='after')
    def single_reminder(self):
        if self.reminder_minutes is not None and self.reminder_at is not None:
            raise ValueError('Chỉ chọn một cách nhắc: trước hạn hoặc ngày giờ cụ thể.')
        return self


def reminder_update(payload):
    data = payload.model_dump(include={'reminder_minutes', 'reminder_at'}, exclude_unset=True)
    if data.get('reminder_minutes') is not None:
        data['reminder_at'] = None
    elif data.get('reminder_at') is not None:
        data['reminder_minutes'] = None
    return data
