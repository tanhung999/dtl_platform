from app.modules.notifications.reminder_fields import ReminderFields
from datetime import date, datetime
from uuid import UUID
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PriorityType = Literal["LOW", "MEDIUM", "URGENT"]


class TaskCreate(ReminderFields):
    is_private: bool = False
    client_request_id: UUID | None = None
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10000)
    priority: PriorityType = "MEDIUM"
    due_date: date | None = None
    due_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    assignee_id: str | None = Field(default=None, max_length=36)
    follower_ids: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("priority", mode="before")
    @classmethod
    def normalize_legacy_priority(cls, value):
        return "MEDIUM" if value == "HIGH" else value

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value):
        return value.strip() if isinstance(value, str) else value

class TaskUpdate(ReminderFields):
    is_private: bool | None = None
    expected_version: int = Field(ge=0)
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10000)
    priority: PriorityType | None = None
    due_date: date | None = None
    due_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    is_completed: bool | None = None
    expected_deadline_version: int | None = Field(default=None, ge=0)
    assignee_id: str | None = Field(default=None, max_length=36)
    follower_ids: list[str] | None = Field(default=None, max_length=50)

    @field_validator("priority", mode="before")
    @classmethod
    def normalize_legacy_priority(cls, value):
        return "MEDIUM" if value == "HIGH" else value

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def reject_null_required_fields(self):
        for name in ("title", "priority", "is_completed", "is_private"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} không được để trống.")
        return self


class TaskResponse(BaseModel):
    @field_validator("priority", mode="before")
    @classmethod
    def normalize_legacy_priority(cls, value):
        return "MEDIUM" if value == "HIGH" else value

    reminder_minutes: int | None = None
    reminder_at: datetime | None = None
    is_private: bool = False
    version: int
    model_config = ConfigDict(from_attributes=True)
    id: str
    user_id: str
    assignee_id: str
    title: str
    description: str | None
    priority: PriorityType
    due_date: date | None
    due_time: str | None
    legacy_due_date: str | None
    deadline_version: int
    is_completed: bool
    created_at: datetime
    updated_at: datetime
    creator: dict | None = None
    assignee: dict | None = None
    followers: list[dict] = []
    is_following: bool = False
    relationship: Literal["OWNER", "ASSIGNEE", "FOLLOWER"] | None = None
    can_edit: bool = False
    can_complete: bool = False
    can_delete: bool = False
    can_assign: bool = False
