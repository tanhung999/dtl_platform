from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Bookmark, Note, User, utcnow
from app.db.workspace_layout import WorkspaceLayout
from app.modules.auth.dependencies import get_current_user
from .schemas import LayoutResponse, LayoutWrite

router = APIRouter(prefix="/api/workspace/layout", tags=["Workspace layout"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db)]
Kind = Literal["apps", "bookmarks", "notes"]


@router.get("", response_model=dict[str, LayoutResponse])
async def get_layout(user: CurrentUser, db: Database):
    rows = (await db.execute(select(WorkspaceLayout).where(WorkspaceLayout.user_id == user.id))).scalars().all()
    result = {kind: {"ids": [], "version": 0} for kind in ("apps", "bookmarks", "notes")}
    result.update({row.kind: {"ids": row.ordered_ids, "version": row.version} for row in rows})
    return result


@router.put("/{kind}", response_model=LayoutResponse)
async def save_layout(kind: Kind, payload: LayoutWrite, user: CurrentUser, db: Database):
    # Serializes the first insert too; never edits global bookmark ordering.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    row = (await db.execute(select(WorkspaceLayout).where(WorkspaceLayout.user_id == user.id, WorkspaceLayout.kind == kind).with_for_update())).scalar_one_or_none()
    if payload.expected_version != (row.version if row else 0):
        raise HTTPException(409, "Thứ tự đã được thay đổi ở nơi khác. Vui lòng thử lại.")
    notes = []
    if kind == "apps":
        allowed = {"bookingreports", "workflows", "itam"}
    elif kind == "bookmarks":
        allowed = set((await db.execute(select(Bookmark.id).where(or_(Bookmark.user_id == user.id, Bookmark.is_global.is_(True))))).scalars())
    else:
        notes = (await db.execute(select(Note).where(Note.user_id == user.id, Note.is_archived.is_(False)).with_for_update())).scalars().all()
        allowed = {note.id for note in notes}
    if not set(payload.ids).issubset(allowed) or not set(payload.pin_changes).issubset(allowed) or (payload.pin_changes and kind != "notes"):
        raise HTTPException(422, "Có mục không tồn tại hoặc không thuộc quyền truy cập của bạn.")
    for note in notes:
        if note.id in payload.pin_changes:
            note.is_pinned = payload.pin_changes[note.id]
            note.updated_at = utcnow()
    if row is None:
        row = WorkspaceLayout(user_id=user.id, kind=kind, ordered_ids=[], version=0)
        db.add(row)
    row.ordered_ids = payload.ids
    row.version += 1
    await db.flush()
    mark_changed(db, user.id, "layout")
    if payload.pin_changes:
        mark_changed(db, user.id, "notes")
    return {"ids": row.ordered_ids, "version": row.version}
