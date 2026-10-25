"""Shared isolated SQLite database, authenticated ASGI requests and collection fixtures."""

import json
import os
import unittest
from urllib.parse import urlencode

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Keep host environment settings and real databases out of the test process.
os.environ["DEBUG"] = "false"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["OIDC_ENABLED"] = "false"

from app.core.database import Base, get_db
from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.models import User
from app.main import app
from app.core.realtime import prepare_changes, broadcast


class ApiTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.previous_oidc_enabled = settings.OIDC_ENABLED
        settings.OIDC_ENABLED = False
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with self.sessions() as session:
            session.add_all([
                User(id="alice", username="alice", email="alice@example.com", full_name="Alice", password_hash=hash_password("test-password")),
                User(id="bob", username="bob", email="bob@example.com", full_name="Bob", password_hash=hash_password("test-password")),
            ])
            await session.commit()

        async def test_db():
            async with self.sessions() as session:
                try:
                    yield session
                    changes = await prepare_changes(session)
                    await session.commit()
                    for user_id, topics in changes.items():
                        broadcast({"user_id": user_id, "topics": sorted(topics)})
                except Exception:
                    await session.rollback()
                    raise

        app.dependency_overrides[get_db] = test_db
        self.tokens = {name: create_access_token({"sub": name}) for name in ("alice", "bob")}

    async def asyncTearDown(self):
        settings.OIDC_ENABLED = self.previous_oidc_enabled
        app.dependency_overrides.clear()
        await self.engine.dispose()

    async def request(self, method, path="/api/calendar/events", *, user="alice", payload=None, query=None, guard=True, headers_extra=None):
        # Fixture writes use the same read/version contract as the UI. Guard-specific tests opt out.
        if guard and payload is not None:
            if method == "PATCH" and path.startswith("/api/tasks/") and "/reminders/" not in path and "expected_version" not in payload:
                _, current = await self.request("GET", path, user=user)
                payload = {**payload, "expected_version": current.get("version", 0)}
            if method == "PUT" and path.startswith("/api/calendar/events/") and "expected_updated_at" not in payload:
                _, current = await self.request("GET", path, user=user)
                payload = {**payload, "expected_updated_at": current.get("updated_at", "2026-01-01T00:00:00Z")}
        if guard and method == "DELETE" and ((path.startswith('/api/tasks/') and path.count('/') == 3) or (path.startswith('/api/calendar/events/') and path.count('/') == 4)):
            _, current = await self.request('GET', path, user=user)
            query = query or ({'expected_version': current.get('version', 0)} if path.startswith('/api/tasks/') else {'expected_updated_at': current.get('updated_at', '2026-01-01T00:00:00Z')})
        if guard and method == "DELETE" and path.startswith('/api/notes/') and path.count('/') == 3 and payload is None:
            _, current = await self.request('GET', path + '/delete-info', user=user)
            payload = {'expected_version': current.get('version', 0)}
        body = json.dumps(payload).encode() if payload is not None else b""
        headers = [(b"content-type", b"application/json")]
        headers.extend((key.lower().encode(), value.encode()) for key, value in (headers_extra or {}).items())
        if user:
            headers.append((b"authorization", f"Bearer {self.tokens[user]}".encode()))
        messages = []

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            messages.append(message)

        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
            "query_string": urlencode(query or {}).encode(), "root_path": "",
            "headers": headers, "server": ("test", 80), "client": ("127.0.0.1", 1),
        }
        await app(scope, receive, send)
        status = next(message["status"] for message in messages if message["type"] == "http.response.start")
        response_body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
        return status, json.loads(response_body) if response_body else None

    def event_payload(self, **overrides):
        return {
            "title": "  Chuẩn bị báo cáo  ", "description": "Ghi chú", "location": "Phòng họp",
            "starts_at": "2026-10-12T09:00:00+07:00", "ends_at": "2026-10-12T10:00:00+07:00",
            "is_all_day": False, "color": "#2563eb", **overrides,
        }

    def range_query(self, **overrides):
        return {"start": "2026-10-12T00:00:00+07:00", "end": "2026-10-13T00:00:00+07:00", **overrides}
