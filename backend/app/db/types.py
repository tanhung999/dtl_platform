"""Native database date/time values with the existing ISO-string application contract."""
from datetime import date, datetime, time, timezone
from sqlalchemy import Date, DateTime, Time
from sqlalchemy.types import TypeDecorator

from app.core.datetime_utils import database_utc

class ISODate(TypeDecorator):
    impl = Date
    cache_ok = True
    def process_bind_param(self, value, dialect):
        return date.fromisoformat(value) if isinstance(value, str) else value
    def process_result_value(self, value, dialect):
        return value.isoformat() if value is not None else None

class ISOTime(TypeDecorator):
    impl = Time
    cache_ok = True
    def process_bind_param(self, value, dialect):
        return time.fromisoformat(value) if isinstance(value, str) else value
    def process_result_value(self, value, dialect):
        return value.strftime('%H:%M') if value is not None else None


class UTCDateTime(TypeDecorator):
    """Store instants in UTC; restore timezone information lost by SQLite.

    Naive writes are rejected: only legacy database reads may assume UTC.
    DATE and TIME columns deliberately keep their separate civil-time contract.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, datetime) or value.utcoffset() is None:
            raise ValueError("UTCDateTime requires a datetime with an explicit timezone")
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return database_utc(value)
