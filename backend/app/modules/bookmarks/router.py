from typing import Annotated, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator
from uuid import UUID
from app.modules.creation import create_once
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Bookmark, User
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/bookmarks", tags=["Bookmarks (Quick Links)"])


class BookmarkCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=500)
    icon: Optional[str] = Field(default="link", max_length=50)
    category: Optional[str] = Field(default="Nội bộ", max_length=80)
    client_request_id: UUID | None = None

    @field_validator('title', 'url', 'icon', 'category', mode='before')
    @classmethod
    def trimmed(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('url')
    @classmethod
    def http_url(cls, value):
        parsed = AnyHttpUrl(value)
        if parsed.username is not None or parsed.password is not None:
            raise ValueError('Liên kết không được chứa tên đăng nhập hoặc mật khẩu.')
        normalized = str(parsed)
        if len(normalized) > 500:
            raise ValueError('Liên kết tối đa 500 ký tự.')
        return normalized


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
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    stmt = (
        select(Bookmark)
        .where(or_(Bookmark.user_id == user.id, Bookmark.is_global.is_(True)))
        .order_by(Bookmark.category, Bookmark.created_at, Bookmark.id)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=BookmarkResponse, status_code=status.HTTP_201_CREATED)
async def create_bookmark(
    payload: BookmarkCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    async def create():
        bookmark = Bookmark(user_id=user.id, title=payload.title, url=payload.url,
            icon=payload.icon or "link", category=payload.category or "Cá nhân", is_global=False)
        db.add(bookmark)
        await db.flush()
        mark_changed(db, user.id, "bookmarks")
        return bookmark
    return await create_once(db, user, 'bookmark', payload.client_request_id,
        payload.model_dump(exclude={'client_request_id'}), Bookmark, create)



@router.delete("/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bookmark(
    bookmark_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    stmt = select(Bookmark).where(Bookmark.id == bookmark_id, Bookmark.user_id == user.id)
    result = await db.execute(stmt)
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(status_code=404, detail="Không tìm thấy liên kết hoặc không có quyền xóa")
    await db.delete(bookmark)
    mark_changed(db, user.id, "bookmarks")
    return None
