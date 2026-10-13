"""Native database date/time values with the existing ISO-string application contract."""
from datetime import date, time
from sqlalchemy import Date, Time
from sqlalchemy.types import TypeDecorator

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
