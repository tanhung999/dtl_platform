"""Private SSE updates; PostgreSQL NOTIFY delivers committed changes across workers."""
import asyncio
import json
from contextlib import asynccontextmanager
from sqlalchemy import text
from sqlalchemy.engine import make_url

CHANNEL = "dtl_workspace_changes"
subscribers: dict[str, set[asyncio.Queue]] = {}


def broadcast(message):
    for queue in tuple(subscribers.get(message["user_id"], ())):
        if queue.full():
            dropped = queue.get_nowait()
            queue.put_nowait(sorted(set(dropped) | set(message["topics"])))
        else:
            queue.put_nowait(message["topics"])


def mark_changed(session, user_id: str, topic: str):
    session.info.setdefault("workspace_changes", {}).setdefault(user_id, set()).add(topic)


async def prepare_changes(session):
    changes = session.info.pop("workspace_changes", {})
    if session.bind.dialect.name == "postgresql":
        for user_id, topics in changes.items():
            await session.execute(text("SELECT pg_notify(:channel, :payload)"),
                {"channel": CHANNEL, "payload": json.dumps({"user_id": user_id, "topics": sorted(topics)})})
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
        while not stopped.is_set():
            connection = None
            disconnected = asyncio.Event()
            try:
                connection = await asyncpg.connect(url)
                connection.add_termination_listener(lambda _: disconnected.set())
                await connection.add_listener(CHANNEL, lambda conn, pid, channel, payload: broadcast(json.loads(payload)))
                ready.set()
                # A reconnect invalidates every subscribed view after any missed messages.
                for user_id in tuple(subscribers):
                    broadcast({"user_id": user_id, "topics": ["tasks", "calendar"]})
                await disconnected.wait()
            except (OSError, asyncpg.PostgresError, asyncio.TimeoutError):
                await asyncio.sleep(1)
            finally:
                if connection and not connection.is_closed():
                    await connection.close()

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


async def stream(user_id, request):
    queue = asyncio.Queue(maxsize=10)
    subscribers.setdefault(user_id, set()).add(queue)
    try:
        yield f'data: {json.dumps({"topics": ["tasks", "calendar"]})}\n\n'
        while not await request.is_disconnected():
            try:
                topics = await asyncio.wait_for(queue.get(), 15)
            except asyncio.TimeoutError:
                topics = ["reminders"]
            yield f'data: {json.dumps({"topics": topics})}\n\n'
    finally:
        subscribers[user_id].discard(queue)
        if not subscribers[user_id]:
            subscribers.pop(user_id, None)
