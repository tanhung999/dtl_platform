import unittest
from tests.support.api_case import ApiTestCase


class CalendarApiTests(ApiTestCase):
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
