from typing import Annotated, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Bookmark, User
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/bookmarks", tags=["Bookmarks (Quick Links)"])


class BookmarkCreate(BaseModel):
    title: str
    url: str
    icon: Optional[str] = "link"
    category: Optional[str] = "Nội bộ"


class BookmarkResponse(BaseModel):
    id: str
    title: str
    url: str
    icon: str
    category: str
    is_global: bool

    class Config:
        from_attributes = True


@router.get("", response_model=List[BookmarkResponse])
async def list_bookmarks(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stmt = (
        select(Bookmark)
        .where(or_(Bookmark.user_id == user.id, Bookmark.is_global.is_(True)))
        .order_by(Bookmark.category, Bookmark.display_order)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=BookmarkResponse, status_code=status.HTTP_201_CREATED)
async def create_bookmark(
    payload: BookmarkCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    bookmark = Bookmark(
        user_id=user.id,
        title=payload.title.strip(),
        url=payload.url.strip(),
        icon=payload.icon or "link",
        category=payload.category or "Cá nhân",
        is_global=False,
    )
    db.add(bookmark)
    await db.flush()
    mark_changed(db, user.id, "bookmarks")
    return bookmark


@router.delete("/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bookmark(
    bookmark_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stmt = select(Bookmark).where(Bookmark.id == bookmark_id, Bookmark.user_id == user.id)
    result = await db.execute(stmt)
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(status_code=404, detail="Không tìm thấy liên kết hoặc không có quyền xóa")
    await db.delete(bookmark)
    mark_changed(db, user.id, "bookmarks")
    return None
