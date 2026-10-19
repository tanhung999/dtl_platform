"""Relative moves serialize per owner; integer ranks have no fractional gap exhaustion."""
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update, func, case, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only
from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Note, User, utcnow
from app.db.workspace_layout import WorkspaceLayout
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/notes", tags=["Notes"])

class NoteMove(BaseModel):
    expected_version: int = Field(ge=0)
    anchor_id: str | None = Field(default=None, max_length=36)
    placement: Literal["before", "after", "start", "end"]
    pinned: bool | None = None

    @model_validator(mode="after")
    def valid_anchor(self):
        if (self.placement in ("before", "after")) != bool(self.anchor_id):
            raise ValueError("Di chuyển trước/sau cần ghi chú mốc.")
        return self

@router.post("/{note_id}/move")
async def move_note(note_id: str, payload: NoteMove, user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db, scope="function")]):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    layout = await db.scalar(select(WorkspaceLayout).options(load_only(WorkspaceLayout.user_id, WorkspaceLayout.kind, WorkspaceLayout.version)).where(WorkspaceLayout.user_id == user.id, WorkspaceLayout.kind == "notes").with_for_update())
    if payload.expected_version != (layout.version if layout else 0):
        raise HTTPException(409, "Danh sách đã thay đổi. Vui lòng kéo lại.")
    note = await db.scalar(select(Note).options(load_only(Note.id, Note.sort_order, Note.is_pinned, Note.version, Note.updated_at)).where(Note.id == note_id, Note.user_id == user.id, Note.is_archived.is_(False)))
    if note is None:
        raise HTTPException(404, "Không tìm thấy ghi chú.")
    if payload.pinned is not None and note.is_pinned != payload.pinned:
        note.is_pinned = payload.pinned
        note.version += 1
        note.updated_at = utcnow()
        await db.flush()
    group = (Note.user_id == user.id, Note.is_archived.is_(False), Note.is_pinned.is_(note.is_pinned), Note.id != note_id)
    anchor = None
    if payload.anchor_id:
        anchor = await db.scalar(select(Note).options(load_only(Note.id, Note.sort_order, Note.is_pinned, Note.version, Note.updated_at)).where(*group, Note.id == payload.anchor_id))
        if anchor is None:
            raise HTTPException(409, "Ghi chú mốc đã thay đổi nhóm. Vui lòng kéo lại.")
    else:
        ordering = Note.sort_order.asc() if payload.placement == "start" else Note.sort_order.desc()
        anchor = await db.scalar(select(Note).options(load_only(Note.id, Note.sort_order, Note.is_pinned, Note.version, Note.updated_at)).where(*group).order_by(ordering, Note.id).limit(1))
    if anchor:
        before = payload.placement in ("before", "start")
        scope = (Note.user_id == user.id, Note.id != note_id)
        edge_fn = func.min if before else func.max
        global_edge, group_edge = (await db.execute(select(edge_fn(Note.sort_order),
            edge_fn(case((and_(*group), Note.sort_order)))).where(*scope))).one()
        if anchor.sort_order == group_edge:
            # Each pin group has its own visual order. A global free edge is also
            # first/last in that group, without shifting the neighboring pin group.
            available, candidate = True, global_edge + (-1 if before else 1)
        else:
            neighbor = await db.scalar(select(func.max(Note.sort_order) if before else func.min(Note.sort_order)).where(
                *scope, Note.sort_order < anchor.sort_order if before else Note.sort_order > anchor.sort_order))
            available = neighbor is None or abs(anchor.sort_order - neighbor) > 1
            candidate = (anchor.sort_order + (-1 if before else 1)) if neighbor is None else (anchor.sort_order + neighbor) // 2
        if available and -(2**63) <= candidate < 2**63:
            # Head/tail moves and existing integer gaps only update the active note.
            note.sort_order = candidate
        else:
            # Dense neighbors never cause gap exhaustion: reuse the source's free slot
            # with one set-based shift, keeping versions/timestamps of others unchanged.
            old, target = note.sort_order, anchor.sort_order
            target += (-1 if old < target else 0) if before else (0 if old < target else 1)
            if old < target:
                stmt = update(Note).where(*scope, Note.sort_order > old, Note.sort_order <= target).values(sort_order=Note.sort_order - 1)
            else:
                stmt = update(Note).where(*scope, Note.sort_order >= target, Note.sort_order < old).values(sort_order=Note.sort_order + 1)
            await db.execute(stmt.values(updated_at=Note.updated_at).execution_options(synchronize_session=False))
            note.sort_order = target
    if layout is None:
        layout = WorkspaceLayout(user_id=user.id, kind="notes", version=0, ordered_ids=[])
        db.add(layout)
    layout.version += 1
    await db.flush()
    for topic in ("notes", "layout"):
        mark_changed(db, user.id, topic)
    return {"version": layout.version}
