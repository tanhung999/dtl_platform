from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.exc import DBAPIError, TimeoutError as PoolTimeout
from fastapi import HTTPException, Request

from app.core.config import settings
from app.core.realtime import prepare_changes, broadcast

pool_options = {"pool_pre_ping": True}
if settings.DATABASE_URL.startswith("postgresql"):
    pool_options.update(dict(pool_size=settings.DB_POOL_SIZE, max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT, pool_recycle=1800,
        connect_args={"timeout": 5, "server_settings": {
            "statement_timeout": str(settings.DB_STATEMENT_TIMEOUT_MS),
            "lock_timeout": str(settings.DB_LOCK_TIMEOUT_MS),
            "idle_in_transaction_session_timeout": "15000"}}))

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    **pool_options,
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()


async def get_db(request: Request) -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        try:
            from app.core.workspace_versions import read_scopes
            if request.method == 'GET' and read_scopes(request.url.path) and session.bind.dialect.name == 'postgresql':
                # The version header and all resource queries see one committed snapshot.
                await session.connection(execution_options={'isolation_level': 'REPEATABLE READ'})
            yield session
            changes = await prepare_changes(session)
            await session.commit()
            for user_id, topics in changes.items():
                broadcast({"user_id": user_id, "topics": sorted(topics)})
        except Exception as reason:
            await session.rollback()
            if isinstance(reason, PoolTimeout) or (isinstance(reason, DBAPIError) and
                (reason.connection_invalidated or getattr(reason.orig, 'sqlstate', None) in ('57014', '55P03', '53300'))):
                raise HTTPException(503, "Hệ thống đang bận. Vui lòng thử lại sau vài giây.", headers={"Retry-After": "2"}) from reason
            raise
        finally:
            await session.close()
