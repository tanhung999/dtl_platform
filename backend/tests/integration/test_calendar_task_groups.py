from tests.support.api_case import ApiTestCase
from app.db.models import Task, TaskFollower


class CalendarTaskGroupTests(ApiTestCase):
    async def seed_tasks(self):
        async with self.sessions() as db:
            db.add_all([
                Task(id="own", user_id="alice", assignee_id="alice", title="Own", due_date="2026-01-01"),
                Task(id="received", user_id="bob", assignee_id="alice", title="Received", due_date="2026-01-01", priority="URGENT"),
                Task(id="following", user_id="bob", assignee_id="bob", title="Following", due_date="2026-01-01"),
                Task(id="outgoing", user_id="alice", assignee_id="bob", title="Outgoing", due_date="2026-01-01"),
                Task(id="hidden", user_id="bob", assignee_id="bob", title="Not visible", due_date="2026-01-01"),
            ])
            await db.flush()
            db.add(TaskFollower(task_id="following", user_id="alice"))
            # Even when also following a received task, it belongs only to assignments.
            db.add(TaskFollower(task_id="received", user_id="alice"))
            await db.commit()

    async def test_groups_filter_before_pagination_and_counts_match_mini_calendar(self):
        await self.seed_tasks()
        query = {"start": "2026-01-01", "end": "2026-01-02", "limit": 1}
        expected = {"all": {"own", "received", "following", "outgoing"}, "assigned": {"received"}, "other": {"own", "following", "outgoing"}, "none": set()}
        for group, ids in expected.items():
            code, page = await self.request("GET", "/api/tasks/calendar/page", query={**query, "task_group": group})
            self.assertEqual(code, 200, page)
            self.assertEqual((page["assigned_total"], page["other_total"]), (1, 3))
            self.assertEqual(page["total"], len(ids))
            self.assertEqual(page["truncated"], len(ids) > 1)
            found = {task["id"] for task in page["items"]}
            for offset in range(1, len(ids)):
                _, more = await self.request("GET", "/api/tasks/calendar/page", query={**query, "task_group": group, "offset": offset})
                found.update(task["id"] for task in more["items"])
            self.assertEqual(found, ids)
            _, days = await self.request("GET", "/api/calendar/days", query={"start": query["start"], "end": query["end"], "task_group": group})
            self.assertEqual(days["2026-01-01"]["tasks"], len(ids))
        _, invalid = await self.request("GET", "/api/tasks/calendar/page", query={**query, "task_group": "unknown"})
        self.assertIn("detail", invalid)

    async def test_overdue_filters_and_other_users_do_not_inherit_assignments(self):
        await self.seed_tasks()
        for group, ids in [("assigned", {"received"}), ("other", {"own", "following", "outgoing"}), ("none", set())]:
            code, page = await self.request("GET", "/api/tasks/collection", query={"filter": "OVERDUE", "task_group": group})
            self.assertEqual(code, 200, page)
            self.assertEqual({task["id"] for task in page["items"]}, ids)
            self.assertEqual(page["counts"]["OVERDUE"], len(ids))
        _, bob = await self.request("GET", "/api/tasks/calendar/page", user="bob", query={"start": "2026-01-01", "end": "2026-01-02", "task_group": "assigned"})
        self.assertEqual({task["id"] for task in bob["items"]}, {"outgoing"})
