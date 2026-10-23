"""Boundary correctness and bounded work for recurring calendar grids."""
from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch
from app.modules.calendar import recurrence


class RecurrenceProjectionTests(TestCase):
    def test_counts_and_pages_match_independent_projection_at_boundaries(self):
        first = datetime(2026, 10, 1, 2, tzinfo=timezone.utc)
        for rule, days in [('NONE', None), ('DAILY', 1), ('WEEKLY', 7)]:
            for duration in [timedelta(minutes=30), timedelta(days=3), timedelta(days=10)]:
                row = dict(id='series', starts_at=first, ends_at=first + duration, recurrence=rule)
                for shift in [-10, 0, 1, 3, 15, 60]:
                    start = first + timedelta(days=shift)
                    for epsilon in [timedelta(0), timedelta(microseconds=1)]:
                        end = start + timedelta(days=7) + epsilon
                        expected = []
                        for i in range(100 if days else 1):
                            begins = first + timedelta(days=(days or 0) * i)
                            finish = begins + duration
                            if begins < end and finish > start:
                                expected.append((begins, finish))
                        actual = recurrence.expand(row, start, end)
                        self.assertEqual([(item['starts_at'], item['ends_at']) for item in actual], expected)
                        self.assertEqual(recurrence.occurrence_count(row, start, end), len(expected))

    def test_merged_pages_are_stable_and_do_not_project_the_full_result(self):
        first = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = [dict(id=f'{i:04}', starts_at=first, ends_at=first + timedelta(hours=1), recurrence='DAILY') for i in range(100)]
        end = first + timedelta(days=93)
        projected = 0
        original = recurrence.iter_occurrences
        def tracked(*args):
            nonlocal projected
            for item in original(*args):
                projected += 1
                yield item
        with patch.object(recurrence, 'iter_occurrences', tracked):
            page = recurrence.occurrence_page(rows, first, end, 25)
        self.assertEqual(len(page), 25)
        self.assertLessEqual(projected, 125)  # One look-ahead per series + selected rows.
        expected = sorted([item for row in rows for item in original(row, first, end)], key=lambda item: (item['starts_at'], item['id']))
        self.assertEqual(page, expected[:25])
        self.assertEqual(recurrence.occurrence_page(rows, first, end, 25, 25), expected[25:50])
        self.assertEqual(recurrence.occurrence_page(rows, first, end, 25, 10000), [])
