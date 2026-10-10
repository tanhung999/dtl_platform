from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel

PriorityType = Literal["LOW", "MEDIUM", "HIGH", "URGENT"]


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: Optional[PriorityType] = "MEDIUM"
    due_date: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[PriorityType] = None
    due_date: Optional[str] = None
    is_completed: Optional[bool] = None
    display_order: Optional[int] = None


class TaskResponse(BaseModel):
    id: str
    user_id: str
    title: str
    description: Optional[str] = None
    priority: str
    due_date: Optional[str] = None
    is_completed: bool
    display_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
