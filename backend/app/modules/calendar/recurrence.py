"""Project a persisted series into a bounded requested interval."""
from datetime import timedelta
from heapq import merge
from itertools import islice
from sqlalchemy import or_
from app.core.datetime_utils import database_utc


def overlaps(model, start, end):
    return (model.starts_at < end, or_(model.ends_at > start, model.recurrence != 'NONE'))


def occurrence_bounds(row, start, end):
    """Return the first overlapping index and exclusive stop without projection."""
    first, finish = database_utc(row['starts_at']), database_utc(row['ends_at'])
    days = {'DAILY': 1, 'WEEKLY': 7}.get(row.get('recurrence'))
    if not days:
        return 0, int(first < end and finish > start), None
    period = timedelta(days=days)
    index = max(0, (start - finish) // period + 1)
    # Ceiling division, preserving the exclusive view end down to microseconds.
    stop = max(0, -((first - end) // period))
    if row.get('recurrence_until'):
        cutoff = database_utc(row['recurrence_until'])
        stop = min(stop, max(0, -((first - cutoff) // period)))
    return index, max(index, stop), period


def occurrence_count(row, start, end):
    index, stop, _ = occurrence_bounds(row, start, end)
    first, finish = database_utc(row['starts_at']), database_utc(row['ends_at'])
    duration = finish - first
    skipped = sum(1 for stamp in row.get('_excluded', ()) if start - duration < stamp < end and valid_occurrence(row, stamp))
    return stop - index - skipped


def valid_occurrence(row, stamp):
    days = {'DAILY': 1, 'WEEKLY': 7}.get(row.get('recurrence'))
    if not days: return False
    delta = stamp - database_utc(row['starts_at'])
    if row.get('recurrence_until') and stamp >= database_utc(row['recurrence_until']): return False
    return delta >= timedelta(0) and delta % timedelta(days=days) == timedelta(0)


async def attach_exclusions(db, rows, start, end):
    """One indexed query for the series in this view, including overlapping spans."""
    from sqlalchemy import select
    from app.db.calendar_exceptions import CalendarException as ExceptionRow
    rows = [dict(row) for row in rows]
    series = {row['id']: row for row in rows if row.get('recurrence') in ('DAILY', 'WEEKLY')}
    if series:
        duration = max(database_utc(row['ends_at']) - database_utc(row['starts_at']) for row in series.values())
        exceptions = (await db.execute(select(ExceptionRow.event_id, ExceptionRow.occurrence_at).where(
            ExceptionRow.event_id.in_(series), ExceptionRow.occurrence_at > start - duration, ExceptionRow.occurrence_at < end))).all()
        for event_id, stamp in exceptions:
            series[event_id].setdefault('_excluded', set()).add(database_utc(stamp))
    return rows


def iter_occurrences(row, start, end):
    row = dict(row)
    first, finish = database_utc(row['starts_at']), database_utc(row['ends_at'])
    index, stop, period = occurrence_bounds(row, start, end)
    if period is None:
        if stop: yield row
        return
    for index in range(index, stop):
        begins, ends = first + index * period, finish + index * period
        if begins in row.get('_excluded', ()): continue
        public = {key: value for key, value in row.items() if key != '_excluded'}
        yield {**public, 'id': f"{row['id']}@{begins.date().isoformat()}", 'series_id': row['id'], 'starts_at': begins, 'ends_at': ends}


def occurrence_page(rows, start, end, limit, offset=0, key=None):
    """Merge sorted series lazily; memory depends on series + page, not occurrences."""
    key = key or (lambda item: (database_utc(item['starts_at']), item['id']))
    streams = [iter_occurrences(row, start, end) for row in rows]
    return list(islice(merge(*streams, key=key), offset, offset + limit))


def expand(row, start, end):
    return list(iter_occurrences(row, start, end))


async def reference_occurrence(db, event_id, starts_at, recurrence, until=None):
    """A useful date for Notes opened without a calendar selection."""
    from datetime import timezone
    from app.db.models import utcnow
    from app.db.calendar_exceptions import CalendarException
    from sqlalchemy import select
    first = database_utc(starts_at)
    days = {'DAILY':1,'WEEKLY':7}.get(recurrence)
    if not days: return first
    period = timedelta(days=days)
    now = utcnow().astimezone(timezone(timedelta(hours=7))).replace(hour=0,minute=0,second=0,microsecond=0)
    index = max(0, -((first - now) // period))
    limit = max(0, -((first-database_utc(until))//period)) if until else None
    if limit is not None: index = min(index,limit-1)
    excluded = set(database_utc(stamp) for stamp in (await db.scalars(select(CalendarException.occurrence_at).where(CalendarException.event_id == event_id))).all())
    candidate=index
    while candidate>=0 and (limit is None or candidate<limit):
        stamp=first+candidate*period
        if stamp not in excluded: return stamp
        candidate+=1
    candidate=index-1
    while candidate>=0:
        stamp=first+candidate*period
        if stamp not in excluded: return stamp
        candidate-=1
    return None
