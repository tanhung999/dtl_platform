"""Calendar integration tests against an isolated SQLite database, without HTTP dependencies.

Run from backend: python -m unittest discover -s tests -v
"""

import json
import os
import unittest
from urllib.parse import urlencode

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Keep host environment settings and real databases out of the test process.
os.environ["DEBUG"] = "false"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"

from app.core.database import Base, get_db
from app.core.security import create_access_token, hash_password
from app.db.models import User
from app.main import app
from app.core.realtime import prepare_changes, broadcast


class CalendarApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
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
        app.dependency_overrides.clear()
        await self.engine.dispose()

    async def request(self, method, path="/api/calendar/events", *, user="alice", payload=None, query=None):
        body = json.dumps(payload).encode() if payload is not None else b""
        headers = [(b"content-type", b"application/json")]
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

    async def test_crud_persistence_and_utc_response(self):
        status, event = await self.request("POST", payload=self.event_payload())
        self.assertEqual(status, 201)
        self.assertEqual(event["title"], "Chuẩn bị báo cáo")
        self.assertEqual(event["user_id"], "alice")
        self.assertEqual(event["starts_at"], "2026-10-12T02:00:00Z")
        path = f'/api/calendar/events/{event["id"]}'
        status, listed = await self.request("GET", query=self.range_query())
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in listed], [event["id"]])
        status, updated = await self.request("PUT", path, payload=self.event_payload(title="Đã cập nhật"))
        self.assertEqual(status, 200)
        self.assertEqual(updated["title"], "Đã cập nhật")
        _, listed = await self.request("GET", query=self.range_query())
        self.assertEqual(listed[0]["title"], "Đã cập nhật")
        status, _ = await self.request("DELETE", path)
        self.assertEqual(status, 204)
        _, listed = await self.request("GET", query=self.range_query())
        self.assertEqual(listed, [])
        status, _ = await self.request("DELETE", path)
        self.assertEqual(status, 404)

    async def test_calendar_is_private_and_requires_login(self):
        _, event = await self.request("POST", payload=self.event_payload())
        path = f'/api/calendar/events/{event["id"]}'
        status, listed = await self.request("GET", user="bob", query=self.range_query())
        self.assertEqual(status, 200)
        self.assertEqual(listed, [])
        for method, payload in [("PUT", self.event_payload()), ("DELETE", None)]:
            status, _ = await self.request(method, path, user="bob", payload=payload)
            self.assertEqual(status, 404)
        status, _ = await self.request("GET", user=None, query=self.range_query())
        self.assertEqual(status, 401)
        status, _ = await self.request("POST", user=None, payload=self.event_payload())
        self.assertEqual(status, 401)
        status, _ = await self.request("POST", payload=self.event_payload(user_id="bob"))
        self.assertEqual(status, 422)

    async def test_all_day_and_overlap_boundaries(self):
        payload = self.event_payload(is_all_day=True, starts_at="2026-10-11T00:00:00+07:00", ends_at="2026-10-13T00:00:00+07:00")
        status, event = await self.request("POST", payload=payload)
        self.assertEqual(status, 201)
        _, listed = await self.request("GET", query=self.range_query())
        self.assertEqual(listed[0]["id"], event["id"])
        _, listed = await self.request("GET", query=self.range_query(start="2026-10-13T00:00:00+07:00", end="2026-10-14T00:00:00+07:00"))
        self.assertEqual(listed, [])
        _, listed = await self.request("GET", query=self.range_query(start="2026-10-10T00:00:00+07:00", end="2026-10-11T00:00:00+07:00"))
        self.assertEqual(listed, [])
        status, _ = await self.request("POST", payload=self.event_payload(is_all_day=True))
        self.assertEqual(status, 422)

    async def test_invalid_times_and_fields_rejected(self):
        for override in [
            {"title": "   "}, {"color": "red"}, {"title": "x" * 201},
            {"starts_at": "2026-10-12T09:00:00"},
            {"ends_at": "2026-10-12T09:00:00+07:00"},
            {"ends_at": "2026-10-11T09:00:00+07:00"},
        ]:
            with self.subTest(override=override):
                status, _ = await self.request("POST", payload=self.event_payload(**override))
                self.assertEqual(status, 422)
        for query in [
            self.range_query(start="2026-10-12T00:00:00"),
            self.range_query(end="2026-10-12T00:00:00+07:00"),
            self.range_query(end="2027-10-12T00:00:00+07:00"),
        ]:
            status, _ = await self.request("GET", query=query)
            self.assertEqual(status, 422)


if __name__ == "__main__":
    unittest.main()
