from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only
from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Bookmark, Note, User, utcnow
from app.db.workspace_layout import WorkspaceLayout
from app.modules.auth.dependencies import get_current_user
from .schemas import LayoutResponse, LayoutWrite
from .order import APP_IDS, clean_order

router = APIRouter(prefix="/api/workspace/layout", tags=["Workspace layout"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]
Kind = Literal["apps", "bookmarks", "notes"]


@router.get("", response_model=dict[str, LayoutResponse])
async def get_layout(user: CurrentUser, db: Database, include_note_ids: bool = True):
    stmt = select(WorkspaceLayout).where(WorkspaceLayout.user_id == user.id)
    if not include_note_ids:
        stmt = stmt.where(WorkspaceLayout.kind != "notes")
    rows = (await db.scalars(stmt)).all()
    result = {kind: {"ids": [], "version": 0} for kind in ("apps", "bookmarks", "notes")}
    result.update({row.kind: {"ids": row.ordered_ids, "version": row.version} for row in rows})
    if not include_note_ids:
        result["notes"]["version"] = await db.scalar(select(WorkspaceLayout.version).where(WorkspaceLayout.user_id == user.id, WorkspaceLayout.kind == "notes")) or 0
    result["notes"]["ids"] = (list((await db.scalars(select(Note.id).where(Note.user_id == user.id, Note.is_archived.is_(False)).order_by(Note.sort_order, Note.id))).all()) if include_note_ids else [])
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
        allowed = APP_IDS
    elif kind == "bookmarks":
        allowed = set((await db.execute(select(Bookmark.id).where(or_(Bookmark.user_id == user.id, Bookmark.is_global.is_(True))))).scalars())
    else:
        notes = (await db.execute(select(Note).options(load_only(Note.id, Note.is_pinned, Note.version, Note.sort_order)).where(Note.user_id == user.id, Note.is_archived.is_(False)).order_by(Note.sort_order, Note.id).with_for_update())).scalars().all()
        allowed = {note.id for note in notes}
    invalid = set(payload.ids) - allowed
    forbidden = bool(invalid) if kind == "apps" else False
    if invalid and kind != "apps":
        model = Bookmark if kind == "bookmarks" else Note
        # Missing items (or own archived notes) may come from an older tab.
        # Existing private items belonging to someone else are still rejected.
        foreign = select(model.id).where(model.id.in_(invalid))
        if kind == "notes":
            foreign = foreign.where(Note.user_id != user.id)
        forbidden = (await db.execute(foreign)).first() is not None
    if forbidden or not set(payload.pin_changes).issubset(allowed) or (payload.pin_changes and kind != "notes"):
        raise HTTPException(422, "Có mục không tồn tại hoặc không thuộc quyền truy cập của bạn.")
    for note in notes:
        if note.id in payload.pin_changes:
            note.version += 1
            note.is_pinned = payload.pin_changes[note.id]
            note.updated_at = utcnow()
    if row is None:
        row = WorkspaceLayout(user_id=user.id, kind=kind, ordered_ids=[], version=0)
        db.add(row)
    row.ordered_ids = clean_order(payload.ids, allowed)
    if kind == "notes":
        positions = {id: i for i, id in enumerate(row.ordered_ids + [note.id for note in notes if note.id not in set(row.ordered_ids)])}
        for note in notes:
            note.sort_order = positions[note.id]
    row.version += 1
    await db.flush()
    mark_changed(db, user.id, "layout")
    if payload.pin_changes:
        mark_changed(db, user.id, "notes")
    return {"ids": row.ordered_ids, "version": row.version}
