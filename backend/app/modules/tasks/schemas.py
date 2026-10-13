from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PriorityType = Literal["LOW", "MEDIUM", "HIGH", "URGENT"]


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10000)
    priority: PriorityType = "MEDIUM"
    due_date: date | None = None
    due_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value):
        return value.strip() if isinstance(value, str) else value

class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10000)
    priority: PriorityType | None = None
    due_date: date | None = None
    due_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    is_completed: bool | None = None
    display_order: int | None = None
    expected_deadline_version: int | None = Field(default=None, ge=0)

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def reject_null_required_fields(self):
        for name in ("title", "priority", "is_completed", "display_order"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} không được để trống.")
        return self


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    user_id: str
    title: str
    description: str | None
    priority: PriorityType
    due_date: date | None
    due_time: str | None
    legacy_due_date: str | None
    deadline_version: int
    is_completed: bool
    display_order: int
    created_at: datetime
    updated_at: datetime


class ReminderResponse(BaseModel):
    task_id: str
    title: str
    due_date: str
    due_time: str | None
    priority: PriorityType
    deadline_version: int
    kind: Literal["before", "day"]
    scheduled_at: datetime


class ReminderDismiss(BaseModel):
    deadline_version: int = Field(ge=0)
