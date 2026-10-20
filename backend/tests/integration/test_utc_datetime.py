"""Contract for timezone-safe storage, independently of API serializers."""
import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, Integer, MetaData, Table, create_engine, select, text
from sqlalchemy.exc import StatementError
from sqlalchemy.dialects import postgresql

from app.db.types import ISODate, ISOTime, UTCDateTime


class UTCDateTimeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        self.table = Table('moments', MetaData(), Column('id', Integer, primary_key=True),
            Column('instant', UTCDateTime()), Column('day', ISODate()), Column('clock', ISOTime()))
        self.table.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)

    def test_offset_writes_reads_and_query_bounds_use_the_same_instant(self):
        instant = datetime(2026, 10, 22, 0, 0, tzinfo=timezone(timedelta(hours=7)))
        with self.engine.begin() as conn:
            conn.execute(self.table.insert().values(instant=instant, day='2026-10-22', clock='09:00'))
            row = conn.execute(select(self.table)).one()
            self.assertEqual(row.instant.isoformat(), '2026-10-21T17:00:00+00:00')
            self.assertEqual((row.day, row.clock), ('2026-10-22', '09:00'))
            self.assertIsNotNone(conn.scalar(select(self.table.c.id).where(self.table.c.instant == instant)))
            self.assertIsNone(conn.scalar(select(self.table.c.id).where(self.table.c.instant < instant)))

    def test_legacy_sqlite_naive_read_is_utc_and_null_is_preserved(self):
        with self.engine.begin() as conn:
            conn.execute(text("INSERT INTO moments (id, instant) VALUES (1, '2026-10-21 18:00:00'), (2, NULL)"))
            rows = conn.execute(select(self.table).order_by(self.table.c.id)).all()
            self.assertEqual(rows[0].instant.isoformat(), '2026-10-21T18:00:00+00:00')
            self.assertIsNone(rows[1].instant)

    def test_naive_new_writes_are_rejected(self):
        with self.engine.begin() as conn:
            with self.assertRaises(StatementError):
                conn.execute(self.table.insert().values(instant=datetime(2026, 10, 22)))

    def test_postgres_type_and_non_utc_session_read_preserve_instant(self):
        datatype = UTCDateTime()
        self.assertEqual(datatype.compile(dialect=postgresql.dialect()), 'TIMESTAMP WITH TIME ZONE')
        value = datetime(2026, 10, 22, 0, tzinfo=timezone(timedelta(hours=7)))
        self.assertEqual(datatype.process_result_value(value, None).isoformat(), '2026-10-21T17:00:00+00:00')

    def test_every_registered_timestamp_column_uses_shared_type(self):
        from app.main import app  # Register every application model without running startup.
        from app.core.database import Base
        self.assertIsNotNone(app)
        timestamps = [column for table in Base.metadata.tables.values() for column in table.columns
            if isinstance(column.type, UTCDateTime) or isinstance(column.type, DateTime)]
        self.assertGreater(len(timestamps), 20)
        self.assertEqual([str(column) for column in timestamps if not isinstance(column.type, UTCDateTime)], [])
