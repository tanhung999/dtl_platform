from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.core.config import settings
from app.core.realtime import prepare_changes, broadcast

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        try:
            yield session
            changes = await prepare_changes(session)
            await session.commit()
            for user_id, topics in changes.items():
                broadcast({"user_id": user_id, "topics": sorted(topics)})
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
