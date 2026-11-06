"""Bounded source reconciliation and durable read outbox. Network runs outside DB transactions."""

import asyncio
import hashlib
import hmac
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import select, text, update

from app.core.config import settings
from app.core.database import async_session_maker, engine
from app.core.realtime import prepare_changes, broadcast
from app.db.applications import (
    Application,
    ApplicationPolicyOwnership as Ownership,
    UserApplicationAccess as Access,
)
from app.db.models import User, utcnow
from app.db.notifications import (
    Notification as Notice,
    ExternalNotificationState as State,
    NotificationReadOutbox as Outbox,
)
from .external_sync import record_read_change
from .integrations import IncomingNotification, resolve_recipient
from .service import fingerprint, changed
from app.db.applications import ApplicationProvisioningPolicy as Creation

log = logging.getLogger(__name__)
SOURCES = ("workflows", "itam", "bookingreports")


class NotLeader(Exception):
    """Release a losing election's connection before waiting to retry."""


def configuration():
    result = {}
    for source in SOURCES:
        url = getattr(settings, f"NOTIFICATIONS_{source.upper()}_SYNC_URL").rstrip("/")
        secret = getattr(settings, f"NOTIFICATIONS_{source.upper()}_SECRET")
        if not url:
            continue
        parts = urlsplit(url)
        if (
            len(secret) < 32
            or parts.scheme not in {"http", "https"}
            or not parts.netloc
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
        ):
            raise ValueError("Invalid private notification configuration: " + source)
        result[source] = (url, secret)
    return result


async def request_source(client, config, source, action, payload):
    url, secret = config
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    if len(body) > 32768:
        raise ValueError("Notification request too large.")
    stamp = str(int(time.time()))
    signature = (
        "sha256="
        + hmac.new(
            secret.encode(),
            f"{stamp}\n{source}\nsource-{action}\n".encode() + body,
            hashlib.sha256,
        ).hexdigest()
    )
    async with client.stream(
        "POST",
        url + "/" + action,
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Notification-Timestamp": stamp,
            "X-Notification-Signature": signature,
        },
    ) as response:
        content = bytearray()
        async for chunk in response.aiter_bytes():
            content.extend(chunk)
            if len(content) > 1048576:
                raise ValueError("Notification response too large.")
        if action == "read" and response.status_code == 404:
            return {"missing": True}
        if action == "read" and response.status_code == 409:
            data = json.loads(content)
            if isinstance(data, dict) and "read_version" in data:
                return {**data, "conflict": True}
        response.raise_for_status()
        data = json.loads(content)
        if not isinstance(data, dict):
            raise ValueError("Invalid notification response.")
        return data


async def commit(db):
    changes = await prepare_changes(db)
    await db.commit()
    for user_id, topics in changes.items():
        broadcast({"user_id": user_id, "topics": sorted(topics)})


def binding_payload(binding):
    return {
        k: binding[k]
        for k in ("recipient_subject", "external_user_id", "link_operation_id")
    }


def source_payload(binding):
    return {
        **binding_payload(binding),
        **(
            {k: binding[k] for k in ("permission_keys", "role_keys")}
            if binding["source"] == "itam"
            else {}
        ),
    }


async def lock_binding(db, binding):
    # Use the exact same checks as signed ingress, including current grants.
    from types import SimpleNamespace

    user = await resolve_recipient(
        db, binding["source"], SimpleNamespace(**binding_payload(binding))
    )
    if binding.get("access_updated_at") is not None:
        grant = await db.get(
            Access, (user.id, binding["source"]), populate_existing=True
        )
        if grant.updated_at != binding["access_updated_at"]:
            raise HTTPException(
                409, "Application permissions changed during synchronization."
            )
    return user


def validate_read(value, external_id):
    if (
        value.get("external_id") != external_id
        or type(value.get("read")) is not bool
        or type(value.get("read_version")) is not int
        or not 0 <= value["read_version"] <= 2147483647
    ):
        raise ValueError("Invalid source read snapshot.")


async def apply_read_result(db, binding, notification_id, revision, result):
    await lock_binding(db, binding)
    notice = await db.get(Notice, notification_id, with_for_update=True)
    state = await db.get(State, notification_id, with_for_update=True)
    queued = await db.get(Outbox, notification_id, with_for_update=True)
    if (
        not notice
        or not state
        or not queued
        or notice.user_id != binding["user_id"]
        or state.link_operation_id != binding["link_operation_id"]
    ):
        return
    if result.get("missing"):
        state.source_visible = False
        queued.acknowledged_revision = max(queued.acknowledged_revision, revision)
        changed(db, notice.user_id)
        return
    validate_read(result, state.external_id)
    if result["read_version"] < state.source_read_version:
        return
    state.source_read_version = result["read_version"]
    # A newer Platform click must survive an older network response.
    if queued.revision != revision:
        return
    if result.get("conflict") and (notice.read_at is not None) != result["read"]:
        notice.read_at = utcnow() if result["read"] else None
        await record_read_change(db, notice, from_source=True)
        changed(db, notice.user_id)
    else:
        queued.acknowledged_revision = max(queued.acknowledged_revision, revision)


async def merge_feed(db, binding, data, known_ids):
    user = await lock_binding(db, binding)
    items, visible = data.get("items"), data.get("visible_known_ids")
    if (
        not isinstance(items, list)
        or len(items) > 200
        or not isinstance(visible, list)
        or not set(visible) <= set(known_ids)
    ):
        raise ValueError("Invalid source notification batch.")
    relevant_ids = set(known_ids) | {
        raw.get("external_id") for raw in items if isinstance(raw, dict)
    }
    pairs = list(
        (
            await db.execute(
                select(Notice, State)
                .join(State, State.notification_id == Notice.id)
                .where(
                    Notice.user_id == user.id,
                    Notice.source == binding["source"],
                    State.link_operation_id == binding["link_operation_id"],
                    State.external_user_id == binding["external_user_id"],
                    State.external_id.in_(relevant_ids),
                )
                .with_for_update(of=Notice)
            )
        ).all()
    )
    saved = {state.external_id: (notice, state) for notice, state in pairs}
    from app.db.notifications import NotificationPreference

    pref = await db.get(NotificationPreference, user.id)
    muted = pref is not None and not getattr(pref, binding["source"])
    new_states = []
    for raw in items:
        external_id = raw.get("external_id")
        validate_read(raw, external_id)
        incoming = IncomingNotification.model_validate(
            {
                **binding_payload(binding),
                **{k: v for k, v in raw.items() if k != "read_version"},
            }
        )
        pair = saved.get(external_id)
        if pair is None:
            key = (
                "external:"
                + hashlib.sha256(
                    f"{binding['link_operation_id']}:{binding['external_user_id']}:{external_id}".encode()
                ).hexdigest()
            )
            now = utcnow()
            notice = Notice(
                id=str(uuid.uuid4()),
                user_id=user.id,
                source=binding["source"],
                event_key=key,
                fingerprint=fingerprint({"source_id": key}),
                title=incoming.title,
                body=incoming.body,
                kind="external." + incoming.kind,
                resource_type=binding["source"] + ".record",
                resource_id=incoming.resource_id,
                action_path=incoming.action_path,
                occurred_at=incoming.occurred_at or now,
                created_at=now,
                read_at=now if incoming.read else None,
                dismissed_at=now if muted else None,
            )
            db.add(notice)
            state = State(
                notification_id=notice.id,
                external_id=external_id,
                identity_subject=binding["recipient_subject"],
                external_user_id=binding["external_user_id"],
                link_operation_id=binding["link_operation_id"],
                read_version=0,
                source_read_version=raw["read_version"],
                source_visible=True,
            )
            new_states.append(state)
            saved[external_id] = notice, state
            changed(db, user.id)
        else:
            notice, state = pair
            if not state.source_visible:
                state.source_visible = True
                changed(db, user.id)
            if raw["read_version"] > state.source_read_version:
                queue = await db.get(Outbox, notice.id)
                if queue is not None and queue.acknowledged_revision < queue.revision:
                    continue
                state.source_read_version = raw["read_version"]
                if (notice.read_at is not None) != incoming.read:
                    notice.read_at = utcnow() if incoming.read else None
                    await record_read_change(db, notice, from_source=True)
                    changed(db, user.id)
    for key in set(known_ids) - set(visible):
        if key in saved and saved[key][1].source_visible:
            saved[key][1].source_visible = False
            changed(db, user.id)
    if new_states:
        # These mappers have no ORM relationship to order their inserts. Persist
        # parents first, then add link rows in the same transaction (one batch).
        await db.flush()
        db.add_all(new_states)
        await db.flush()


async def sync_binding(client, config, binding, cursor="", known_offset=0):
    async with async_session_maker() as db:
        await lock_binding(db, binding)
        pending = (
            await db.execute(
                select(
                    Notice.id,
                    State.external_id,
                    State.source_read_version,
                    Outbox.revision,
                    Notice.read_at,
                )
                .join(State, State.notification_id == Notice.id)
                .join(Outbox, Outbox.notification_id == Notice.id)
                .where(
                    Notice.user_id == binding["user_id"],
                    Notice.source == binding["source"],
                    State.link_operation_id == binding["link_operation_id"],
                    Outbox.acknowledged_revision < Outbox.revision,
                )
                .order_by(Outbox.updated_at, Notice.id)
                .limit(10)
            )
        ).all()
    for row in pending:
        result = await request_source(
            client,
            config,
            binding["source"],
            "read",
            {
                **source_payload(binding),
                "external_id": row.external_id,
                "read": row.read_at is not None,
                "expected_version": row.source_read_version,
            },
        )
        async with async_session_maker() as db:
            await apply_read_result(db, binding, row.id, row.revision, result)
            await commit(db)
    async with async_session_maker() as db:
        known = list(
            (
                await db.scalars(
                    select(State.external_id)
                    .join(Notice, Notice.id == State.notification_id)
                    .where(
                        Notice.user_id == binding["user_id"],
                        Notice.source == binding["source"],
                        State.link_operation_id == binding["link_operation_id"],
                    )
                    .order_by(State.external_id)
                    .offset(known_offset)
                    .limit(100)
                )
            ).all()
        )
    data = await request_source(
        client,
        config,
        binding["source"],
        "feed",
        {**source_payload(binding), "cursor": cursor, "known_ids": known},
    )
    next_cursor = data.get("next_cursor")
    if not isinstance(next_cursor, str) or len(next_cursor) > 512:
        raise ValueError("Invalid source cursor.")
    async with async_session_maker() as db:
        await merge_feed(db, binding, data, known)
        await commit(db)
    return next_cursor, known_offset + 100 if len(known) == 100 else 0


async def eligible_bindings(db, sources, offset=0):
    rows = (
        (
            await db.execute(
                select(
                    User.id.label("user_id"),
                    User.identity_subject.label("recipient_subject"),
                    Ownership.application_key.label("source"),
                    Ownership.external_user_id,
                    Ownership.operation_id.label("link_operation_id"),
                    Access.updated_at.label("access_updated_at"),
                )
                .join(Ownership, Ownership.user_id == User.id)
                .join(
                    Access,
                    (Access.user_id == User.id)
                    & (Access.application_key == Ownership.application_key),
                )
                .join(Application, Application.key == Ownership.application_key)
                .where(
                    User.is_active.is_(True),
                    User.identity_subject.is_not(None),
                    Ownership.application_key.in_(sources),
                    ~select(Creation.user_id)
                    .where(
                        Creation.user_id == User.id,
                        Creation.application_key == Ownership.application_key,
                        Creation.unlink_operation_id.is_not(None),
                    )
                    .correlate(User, Ownership)
                    .exists(),
                    Access.enabled.is_(True),
                    Application.is_active.is_(True),
                )
                .order_by(User.id, Ownership.application_key)
                .offset(offset)
                .limit(25)
            )
        )
        .mappings()
        .all()
    )
    values = [dict(row) for row in rows]
    for binding in values:
        if binding["source"] == "itam":
            from app.modules.applications.router import _access_view

            policy = await _access_view(
                db,
                await db.get(Application, "itam"),
                await db.get(Access, (binding["user_id"], "itam")),
            )
            binding.update(
                permission_keys=policy.permission_keys, role_keys=policy.role_keys
            )
    return values


async def hide_rejected_binding(db, binding):
    await lock_binding(db, binding)
    ids = select(Notice.id).where(
        Notice.user_id == binding["user_id"], Notice.source == binding["source"]
    )
    result = await db.execute(
        update(State)
        .where(
            State.notification_id.in_(ids),
            State.link_operation_id == binding["link_operation_id"],
            State.source_visible.is_(True),
        )
        .values(source_visible=False)
    )
    if result.rowcount:
        changed(db, binding["user_id"])


@asynccontextmanager
async def run_source_bridge():
    configs = configuration()
    task = None

    async def loop():
        positions, failures, offset = {}, {}, 0
        backoff = 1
        while True:
            try:
                # One elected worker per database. A dedicated session lock is released
                # by PostgreSQL on crashes; it never locks user/business rows.
                async with engine.connect() as connection:
                    leader = await connection.execution_options(
                        isolation_level="AUTOCOMMIT"
                    )
                    if engine.dialect.name == "postgresql" and not await leader.scalar(
                        text("SELECT pg_try_advisory_lock(831105002)")
                    ):
                        raise NotLeader()
                    try:
                        async with httpx.AsyncClient(
                            timeout=httpx.Timeout(4, connect=1),
                            follow_redirects=False,
                            trust_env=False,
                        ) as client:
                            semaphore = asyncio.Semaphore(4)
                            while True:
                                await leader.execute(text("SELECT 1"))
                                async with async_session_maker() as db:
                                    bindings = await eligible_bindings(
                                        db, list(configs), offset
                                    )
                                offset = offset + 25 if len(bindings) == 25 else 0

                                async def one(binding):
                                    key = (
                                        binding["user_id"],
                                        binding["source"],
                                        binding["link_operation_id"],
                                    )
                                    retry_at, last_warning, count = failures.get(
                                        key, (0, 0, 0)
                                    )
                                    if time.monotonic() < retry_at:
                                        return
                                    async with semaphore:
                                        try:
                                            positions[key] = await sync_binding(
                                                client,
                                                configs[binding["source"]],
                                                binding,
                                                *positions.get(key, ("", 0)),
                                            )
                                            failures.pop(key, None)
                                        except asyncio.CancelledError:
                                            raise
                                        except Exception as error:
                                            if isinstance(
                                                error, httpx.HTTPStatusError
                                            ) and error.response.status_code in {
                                                403,
                                                409,
                                            }:
                                                async with async_session_maker() as db:
                                                    try:
                                                        await hide_rejected_binding(
                                                            db, binding
                                                        )
                                                        await commit(db)
                                                    except HTTPException:
                                                        pass  # A newer Platform link already superseded this response.
                                            # No response/config/secret is included in logs; retry
                                            # from durable state after outage or partial handover.
                                            now = time.monotonic()
                                            if now - last_warning > 60:
                                                log.warning(
                                                    "Notification adapter retry: source=%s error=%s",
                                                    binding["source"],
                                                    type(error).__name__,
                                                )
                                                last_warning = now
                                            failures[key] = (
                                                now + min(30, 2 ** min(count + 1, 5)),
                                                last_warning,
                                                count + 1,
                                            )

                                await asyncio.gather(
                                    *(one(binding) for binding in bindings)
                                )
                                if len(positions) > 10000:
                                    positions.clear()  # Safe replay; identities deduplicate deliveries.
                                if len(failures) > 10000:
                                    failures.clear()
                                backoff = 1
                                await asyncio.sleep(
                                    0.05
                                    if len(bindings) == 25
                                    else settings.NOTIFICATIONS_SYNC_INTERVAL_SECONDS
                                )
                    finally:
                        if engine.dialect.name == "postgresql":
                            await leader.execute(
                                text("SELECT pg_advisory_unlock(831105002)")
                            )
            except NotLeader:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning(
                    "Notification source bridge unavailable; durable changes will retry."
                )
                await asyncio.sleep(min(30, backoff))
                backoff *= 2

    if configs:
        task = asyncio.create_task(loop())
    try:
        yield
    finally:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
