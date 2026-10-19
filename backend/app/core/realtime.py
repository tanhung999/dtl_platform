"""Private SSE updates; PostgreSQL NOTIFY delivers committed changes across workers."""
import asyncio
import json
import random
from contextlib import asynccontextmanager
from sqlalchemy import text
from sqlalchemy.engine import make_url

CHANNEL = "dtl_workspace_changes"
ALL_TOPICS = ["tasks", "calendar", "notes", "layout", "widget-layout", "notifications", "calendar-sharing", "shared-calendar", "bookmarks"]
subscribers: dict[str, set[asyncio.Queue]] = {}


def broadcast(message):
    for queue in tuple(subscribers.get(message["user_id"], ())):
        if queue.full():
            dropped = queue.get_nowait()
            versions = dict(dropped.get('versions', {}))
            for topic, version in message.get('versions', {}).items(): versions[topic] = max(version, versions.get(topic, 0))
            queue.put_nowait({'topics': sorted(set(dropped['topics']) | set(message['topics'])), 'versions': versions,
                             'reconcile': dropped.get('reconcile', False) or message.get('reconcile', False) or not message.get('versions')})
        else:
            queue.put_nowait(message)


def mark_changed(session, user_id: str, topic: str):
    session.info.setdefault("workspace_changes", {}).setdefault(user_id, set()).add(topic)


async def prepare_changes(session):
    changes = session.info.pop("workspace_changes", {})
    owners = [owner for owner, topics in changes.items() if set(topics) & {'calendar', 'tasks', 'notes', 'calendar-privacy'}]
    if owners:
        from sqlalchemy import select
        from app.db.access import CalendarShare
        # One query for all changed owners; never notify inactive grants or unrelated scopes.
        grants = (await session.execute(select(CalendarShare.owner_id, CalendarShare.viewer_id,
            CalendarShare.share_events, CalendarShare.share_tasks, CalendarShare.share_notes)
            .where(CalendarShare.owner_id.in_(owners), CalendarShare.revoked_at.is_(None)))).all()
        for owner, viewer, events, tasks, notes in grants:
            topics = changes[owner]
            relevant = (events or notes) and bool(topics & {'calendar', 'calendar-privacy'}) or tasks and 'tasks' in topics or notes and 'notes' in topics
            if relevant:
                changes.setdefault(viewer, set()).add('shared-calendar')
                if 'calendar-privacy' in topics: changes[viewer].add('calendar-sharing')
    from app.core.workspace_versions import advance_versions
    versions = await advance_versions(session, changes)
    if session.bind.dialect.name == "postgresql":
        for user_id, topics in changes.items():
            await session.execute(text("SELECT pg_notify(:channel, :payload)"),
                {"channel": CHANNEL, "payload": json.dumps({"user_id": user_id, "topics": sorted(topics), 'versions': versions[user_id]})})
        return {}
    return changes


@asynccontextmanager
async def listen(database_url):
    if make_url(database_url).get_backend_name() != "postgresql":
        yield
        return
    import asyncpg
    stopped = asyncio.Event()
    ready = asyncio.Event()
    url = make_url(database_url).set(drivername="postgresql").render_as_string(hide_password=False)

    async def run():
        failures = 0
        while not stopped.is_set():
            connection = None
            disconnected = asyncio.Event()
            began = asyncio.get_running_loop().time()
            try:
                connection = await asyncpg.connect(url, timeout=5)
                connection.add_termination_listener(lambda _: disconnected.set())
                await connection.add_listener(CHANNEL, lambda conn, pid, channel, payload: broadcast(json.loads(payload)))
                ready.set()
                # A reconnect invalidates every subscribed view after any missed messages.
                for user_id in tuple(subscribers):
                    broadcast({"user_id": user_id, "topics": ALL_TOPICS})
                await disconnected.wait()
            except (OSError, asyncpg.PostgresError, asyncio.TimeoutError):
                pass
            finally:
                if connection and not connection.is_closed():
                    await connection.close()
            if asyncio.get_running_loop().time() - began > 30:
                failures = 0
            ceiling = min(30, 2 ** min(failures, 5))
            failures += 1
            await asyncio.sleep(random.uniform(0.5, ceiling + 0.5))

    listener = asyncio.create_task(run())
    try:
        await asyncio.wait_for(ready.wait(), 15)
        yield
    finally:
        stopped.set()
        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass


async def stream(user_id, request, version_loader=None):
    queue = asyncio.Queue(maxsize=10)
    subscribers.setdefault(user_id, set()).add(queue)
    try:
        # Register first, then read versions: a commit during this read stays queued.
        versions = await version_loader() if version_loader else {}
        yield f'data: {json.dumps({"kind": "ready", "topics": ALL_TOPICS, "versions": versions})}\n\n'
        while not await request.is_disconnected():
            try:
                message = await asyncio.wait_for(queue.get(), 15)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
                continue
            if version_loader and (message.get('reconcile') or not message.get('versions')):
                message = {**message, 'versions': await version_loader()}
            yield f'data: {json.dumps({"kind": "change", **message})}\n\n'
    finally:
        subscribers[user_id].discard(queue)
        if not subscribers[user_id]:
            subscribers.pop(user_id, None)
