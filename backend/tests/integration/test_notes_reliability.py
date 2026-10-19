"""Creation replay, bounded previews, ownership and shared Vietnamese search."""
import unittest
from uuid import uuid4
from tests.support import api_case as test_calendar
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine
from app.db.models import Note
from app.db.note_create_requests import NoteCreateRequest
from app.db.migrations.note_reliability import migrate_note_reliability

class NoteReliabilityTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request
    event_payload = test_calendar.ApiTestCase.event_payload

    async def test_request_replay_mismatch_owner_and_deleted_tombstone(self):
        payload = {"title": "Đề xuất", "content": "Báo cáo", "request_id": str(uuid4())}
        status, first = await self.request("POST", "/api/notes", payload=payload)
        self.assertEqual(status, 201)
        _, replay = await self.request("POST", "/api/notes", payload=payload)
        self.assertEqual(first["id"], replay["id"])
        self.assertEqual((await self.request("POST", "/api/notes", payload={**payload, "title": "other"}))[0], 409)
        _, other = await self.request("POST", "/api/notes", user="bob", payload=payload)
        self.assertNotEqual(first["id"], other["id"])
        await self.request("PATCH", "/api/notes/" + first["id"], payload={"title": "Updated", "expected_version": 0})
        self.assertEqual((await self.request("POST", "/api/notes", payload=payload))[1]["title"], "Updated")
        await self.request("DELETE", "/api/notes/" + first["id"])
        self.assertEqual((await self.request("POST", "/api/notes", payload=payload))[0], 410)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(Note)), 1)
            self.assertEqual(await db.scalar(select(func.count()).select_from(NoteCreateRequest)), 2)

    async def test_pages_previews_widget_order_and_privacy(self):
        notes = []
        for i in range(29):
            _, note = await self.request("POST", "/api/notes", payload={"title": str(i), "content": "x" * 1000, "is_pinned": i < 2})
            notes.append(note)
        order = [row["id"] for row in notes]
        await self.request("PUT", "/api/workspace/layout/notes", payload={"ids": order, "expected_version": 0})
        endpoint = "/api/notes/collection/page"
        status, page = await self.request("GET", endpoint)
        self.assertEqual(status, 200)
        self.assertEqual(page["total"], 29)
        self.assertEqual([row["id"] for row in page["items"]], order[:24])
        self.assertEqual(page["order_ids"], order[:24])
        self.assertTrue(page["has_more"])
        self.assertTrue(all("content" not in row and len(row["preview"]) == 240 for row in page["items"]))
        _, second = await self.request("GET", endpoint, query={"offset": 24})
        self.assertEqual([row["id"] for row in second["items"]], order[24:])
        _, widget = await self.request("GET", endpoint, query={"widget": "true"})
        self.assertEqual(len(widget["items"]), 8)
        self.assertEqual(widget["hidden"], 21)
        self.assertEqual((await self.request("GET", endpoint, user="bob"))[1]["items"], [])
        self.assertEqual((await self.request("GET", endpoint, user=None))[0], 401)
        self.assertEqual((await self.request("GET", endpoint, query={"limit": 1000}))[0], 422)

    async def test_vietnamese_search_in_server_pages_and_archive(self):
        _, note = await self.request("POST", "/api/notes", payload={"title": "ĐỀ XUẤT", "content": "Họp phòng kinh doanh"})
        for q in ["de xuat", "Đề Xuất", "PHONG KINH DOANH"]:
            _, page = await self.request("GET", "/api/notes/collection/page", query={"q": q})
            self.assertEqual([row["id"] for row in page["items"]], [note["id"]])
        self.assertEqual((await self.request("GET", "/api/notes/collection/page", query={"q": "%%"}))[1]['items'], [])
        await self.request("PATCH", "/api/notes/" + note["id"], payload={"title": "Mới", "content": "Khác", "expected_version": 0, "is_archived": True})
        self.assertEqual((await self.request("GET", "/api/notes/collection/page", query={"q": "de xuat"}))[1]['items'], [])
        self.assertEqual((await self.request("GET", "/api/notes/collection/page", query={"archived": "true", "q": "khac"}))[1]["total"], 1)

    async def test_migration_backfills_without_changing_content_and_can_rerun(self):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        try:
            async with engine.begin() as conn:
                await conn.execute(text("CREATE TABLE notes (id VARCHAR PRIMARY KEY, user_id VARCHAR, title TEXT, content TEXT, is_archived BOOLEAN, created_at TIMESTAMP)"))
                await conn.execute(text("CREATE TABLE calendar_events (id VARCHAR PRIMARY KEY, title TEXT)"))
                await conn.execute(text("INSERT INTO notes VALUES ('n', 'u', 'Đề xuất', 'Nội dung', 0, CURRENT_TIMESTAMP)"))
                await conn.execute(text("INSERT INTO calendar_events VALUES ('e', 'Họp điều hành')"))
                for _ in range(2):
                    await migrate_note_reliability(conn)
                row = (await conn.execute(text("SELECT title, content, search_text FROM notes"))).one()
                self.assertEqual(tuple(row), ("Đề xuất", "Nội dung", "de xuat\nnoi dung"))
        finally:
            await engine.dispose()
