"""Reliable session revocations, with entitlement generations as a second check."""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm.attributes import set_committed_value
from app.core.database import async_session_maker
from app.db.models import User, utcnow
from app.db.applications import ApplicationPolicyOwnership, ApplicationSecurityEvent

log = logging.getLogger(__name__)


async def enqueue_revocation(db, user):
    generation = await db.scalar(
        update(User)
        .where(User.id == user.id)
        .values(external_session_version=User.external_session_version + 1)
        .returning(User.external_session_version)
    )
    set_committed_value(user, "external_session_version", generation)
    owners = (
        await db.scalars(
            select(ApplicationPolicyOwnership).where(
                ApplicationPolicyOwnership.user_id == user.id
            )
        )
    ).all()
    for owner in owners:
        if user.identity_subject:
            db.add(
                ApplicationSecurityEvent(
                    user_id=user.id,
                    application_key=owner.application_key,
                    identity_subject=user.identity_subject,
                    external_user_id=owner.external_user_id,
                    operation_id=owner.operation_id,
                    session_version=user.external_session_version,
                )
            )
    await db.flush()


async def deliver(identity):
    from .policy_linking import remote

    async with async_session_maker() as db:
        async with db.begin():
            row = await db.scalar(
                select(ApplicationSecurityEvent)
                .where(
                    ApplicationSecurityEvent.id == identity,
                    ApplicationSecurityEvent.processed_at.is_(None),
                    ApplicationSecurityEvent.available_at <= utcnow(),
                )
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return
            owner = await db.get(
                ApplicationPolicyOwnership, (row.user_id, row.application_key)
            )
            if (
                not owner
                or owner.operation_id != row.operation_id
                or owner.external_user_id != row.external_user_id
            ):
                row.processed_at = utcnow()
                return
            try:
                await remote(
                    row.application_key,
                    "POST",
                    "/revoke-sessions",
                    body={
                        "identity_subject": row.identity_subject,
                        "external_user_id": row.external_user_id,
                        "link_operation_id": row.operation_id,
                        "session_version": row.session_version,
                    },
                )
                row.processed_at = utcnow()
                row.last_error = None
            except Exception as error:
                row.attempts += 1
                row.available_at = utcnow() + timedelta(
                    seconds=min(300, 2 ** min(row.attempts, 8))
                )
                row.last_error = type(error).__name__
                log.warning(
                    "Application session revocation retry: application=%s error=%s",
                    row.application_key,
                    row.last_error,
                )


async def process_pending():
    async with async_session_maker() as db:
        ids = list(
            (
                await db.scalars(
                    select(ApplicationSecurityEvent.id)
                    .where(
                        ApplicationSecurityEvent.processed_at.is_(None),
                        ApplicationSecurityEvent.available_at <= utcnow(),
                    )
                    .order_by(
                        ApplicationSecurityEvent.available_at,
                        ApplicationSecurityEvent.id,
                    )
                    .limit(20)
                )
            ).all()
        )
    semaphore = asyncio.Semaphore(4)

    async def one(identity):
        async with semaphore:
            await deliver(identity)

    await asyncio.gather(*(one(identity) for identity in ids))


@asynccontextmanager
async def run_security_worker():
    async def loop():
        while True:
            try:
                await process_pending()
            except Exception as error:
                log.warning(
                    "Application security worker retry: error=%s", type(error).__name__
                )
            await asyncio.sleep(2)

    task = asyncio.create_task(loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
