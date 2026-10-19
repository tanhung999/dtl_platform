from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import User
from app.db.widget_layout import WorkspaceWidgetLayout
from app.modules.auth.dependencies import get_current_user
from .widget_layout import SCHEMA_VERSION, WidgetLayoutResponse, WidgetLayoutWrite, normalize_columns

router = APIRouter(prefix="/api/workspace/widgets", tags=["Workspace widgets"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]


def response(row):
    if row is not None and row.schema_version != SCHEMA_VERSION:
        raise HTTPException(409, "Phiên bản bố cục chưa được hỗ trợ. Vui lòng tải lại ứng dụng.")
    return {"columns": normalize_columns(row.columns if row else {}), "version": row.version if row else 0, "schema_version": SCHEMA_VERSION}


@router.get("", response_model=WidgetLayoutResponse)
async def get_widgets(user: CurrentUser, db: Database):
    return response(await db.get(WorkspaceWidgetLayout, user.id))


@router.put("", response_model=WidgetLayoutResponse)
async def save_widgets(payload: WidgetLayoutWrite, user: CurrentUser, db: Database):
    if not payload.bounded():
        raise HTTPException(422, "Bố cục không hợp lệ.")
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    row = (await db.execute(select(WorkspaceWidgetLayout).where(WorkspaceWidgetLayout.user_id == user.id).with_for_update())).scalar_one_or_none()
    current = response(row)
    if payload.expected_version != current["version"]:
        raise HTTPException(409, "Bố cục đã thay đổi ở nơi khác. Vui lòng thử lại.")
    if row is None:
        row = WorkspaceWidgetLayout(user_id=user.id, version=0, schema_version=SCHEMA_VERSION)
        db.add(row)
    row.columns = normalize_columns(payload.columns)
    row.version += 1
    await db.flush()
    mark_changed(db, user.id, "widget-layout")
    return response(row)
