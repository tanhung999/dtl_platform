"""Scoped mutations keep past occurrences and share the owner's transaction lock."""
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select, delete, update
from app.core.datetime_utils import database_utc
from app.core.realtime import mark_changed
from app.db.calendar import CalendarEvent
from app.db.calendar_exceptions import CalendarException
from app.db.models import Note, utcnow
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.notifications import Notification, NotificationJob
from app.modules.notifications.scheduling import sync_event_jobs, signature
from .recurrence import valid_occurrence


async def series_rule(db, event_id, recurrence):
    if recurrence != 'NONE': return recurrence
    from .deletion import recurrence_parent
    seen=set()
    while event_id not in seen:
        seen.add(event_id)
        parent_id=await recurrence_parent(db,event_id,(await db.get(CalendarEvent,event_id)).user_id)
        if not parent_id: break
        parent=await db.get(CalendarEvent,parent_id)
        if parent.recurrence != 'NONE': return parent.recurrence
        event_id=parent.id
    return None


async def selected(db, event, at):
    if at is None or at.tzinfo is None:
        raise HTTPException(422, 'Hãy chọn lần lặp cần thao tác.')
    at = database_utc(at)
    if not valid_occurrence({'starts_at': event.starts_at, 'recurrence': event.recurrence,
        'recurrence_until': event.recurrence_until}, at) or await db.get(CalendarException, (event.id, at)):
        raise HTTPException(409, 'Lần lặp đã thay đổi hoặc không còn tồn tại. Hãy mở lại lịch.')
    return at


async def source_changed(db, event):
    event.updated_at = utcnow()
    note_id = await db.scalar(select(NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.event_id == event.id))
    note = await db.get(Note, note_id) if note_id else None
    if note:
        note.version += 1
        note.updated_at = utcnow()
    await db.flush()
    mark_changed(db, event.user_id, 'calendar')
    if note: mark_changed(db, event.user_id, 'notes')
    mark_changed(db, event.user_id, 'notifications')


async def cutoff(db, event, at):
    before = signature(event, 'event')
    event.recurrence_until = min(database_utc(event.recurrence_until), at) if event.recurrence_until else at
    await sync_event_jobs(db, event, before=before, allow_elapsed=True)


async def delete_branch(db, event_id, user_id, delete_notes=False):
    ids, pending = {event_id}, [event_id]
    while pending:
        children = set((await db.scalars(select(CalendarEvent.id).join(CalendarException,
            CalendarException.replacement_id == CalendarEvent.id).where(CalendarException.event_id.in_(pending),
            CalendarEvent.user_id == user_id))).all()) - ids
        ids.update(children)
        pending = list(children)
    note_ids = list((await db.scalars(select(NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.event_id.in_(ids)))).all())
    await db.execute(delete(NoteCalendarSchedule).where(NoteCalendarSchedule.event_id.in_(ids)))
    await db.execute(delete(NotificationJob).where(NotificationJob.event_id.in_(ids)))
    await db.execute(update(Notification).where(Notification.event_id.in_(ids)).values(event_id=None))
    await db.execute(delete(CalendarException).where(CalendarException.event_id.in_(ids)))
    await db.execute(update(CalendarException).where(CalendarException.replacement_id.in_(ids)).values(replacement_id=None))
    await db.execute(delete(CalendarEvent).where(CalendarEvent.id.in_(ids), CalendarEvent.user_id == user_id))
    if delete_notes and note_ids:
        from app.db.note_create_requests import NoteCreateRequest
        await db.execute(delete(NotificationJob).where(NotificationJob.note_id.in_(note_ids)))
        await db.execute(update(Notification).where(Notification.note_id.in_(note_ids)).values(note_id=None))
        await db.execute(update(NoteCreateRequest).where(NoteCreateRequest.note_id.in_(note_ids)).values(note_id=None))
        await db.execute(delete(Note).where(Note.id.in_(note_ids), Note.user_id == user_id))
    return bool(note_ids)


async def scoped_delete(db, event, scope, at):
    if event.recurrence == 'NONE':
        link=await db.scalar(select(CalendarException).where(CalendarException.replacement_id == event.id))
        if not link or not at or at.tzinfo is None or database_utc(at) != database_utc(event.starts_at):
            raise HTTPException(409,'Lần đã chỉnh riêng vừa thay đổi. Hãy mở lại lịch.')
        parent=await db.get(CalendarEvent,link.event_id)
        if scope == 'THIS':
            await delete_branch(db,event.id,event.user_id)
            await source_changed(db,parent)
            return
        at=database_utc(link.occurrence_at)
        event=parent
    else:
        at = await selected(db, event, at)
    if scope == 'THIS':
        db.add(CalendarException(event_id=event.id, occurrence_at=at))
    else:
        # Remove replacements/future segments attached at or after the boundary.
        children = list((await db.scalars(select(CalendarException.replacement_id).where(
            CalendarException.event_id == event.id, CalendarException.occurrence_at >= at,
            CalendarException.replacement_id.is_not(None)))).all())
        for child in children:
            await delete_branch(db, child, event.user_id, delete_notes=False)
        await cutoff(db, event, at)
    await source_changed(db, event)


async def scoped_move(db, event, scope, at, target):
    at = await selected(db, event, at)
    previous_until = database_utc(event.recurrence_until).isoformat() if event.recurrence_until else None
    note_id = await db.scalar(select(NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.event_id == event.id))
    note = await db.get(Note, note_id) if note_id else None
    data = {key:getattr(event,key) for key in ('title','description','location','color','is_private')}
    data.update(target)
    data['starts_at'] = datetime.fromisoformat(data['starts_at'])
    data['ends_at'] = datetime.fromisoformat(data['ends_at'])
    if isinstance(data.get('reminder_at'), str): data['reminder_at'] = datetime.fromisoformat(data['reminder_at'])
    # An unchanged absolute reminder belongs to the source and must not be duplicated.
    if data.get('reminder_at') and event.reminder_at and database_utc(data['reminder_at']) == database_utc(event.reminder_at):
        data['reminder_at'] = None
    if scope == 'THIS': data['recurrence'] = 'NONE'
    child = CalendarEvent(user_id=event.user_id, **data)
    if scope == 'FOLLOWING' and event.recurrence_until:
        # Preserve the number of retained starts when the series was already bounded.
        child.recurrence_until = database_utc(event.recurrence_until) + (data['starts_at'] - at)
    db.add(child)
    await db.flush()
    child_note = None
    if note:
        child_note = Note(user_id=note.user_id, title=note.title, content=note.content, color=note.color,
            is_pinned=note.is_pinned, is_private=note.is_private, is_archived=note.is_archived)
        db.add(child_note)
        await db.flush()
        db.add(NoteCalendarSchedule(note_id=child_note.id, event_id=child.id))
    transferred = []
    if scope == 'FOLLOWING':
        existing = list((await db.scalars(select(CalendarException).where(CalendarException.event_id == event.id,
            CalendarException.occurrence_at > at))).all())
        for exception in existing:
            old_at = database_utc(exception.occurrence_at)
            new_at = old_at + (data['starts_at'] - at)
            transferred.append({'before':old_at.isoformat(), 'after':new_at.isoformat()})
            exception.event_id = child.id
            exception.occurrence_at = new_at
    db.add(CalendarException(event_id=event.id, occurrence_at=at, replacement_id=child.id))
    if scope == 'FOLLOWING': await cutoff(db, event, at)
    await sync_event_jobs(db, child, active=not note.is_archived if note else True, allow_elapsed=True)
    await source_changed(db, event)
    return {'scope':scope, 'occurrence_at':at.isoformat(), 'child_id':child.id,
        'child_updated_at':database_utc(child.updated_at).isoformat(), 'child_note_id':child_note.id if child_note else None,
        'child_note_version':child_note.version if child_note else None, 'previous_until':previous_until,
        'source_updated_at':database_utc(event.updated_at).isoformat(), 'transferred':transferred}


async def undo_scoped(db, event, metadata):
    child = await db.get(CalendarEvent, metadata['child_id'])
    note = await db.get(Note, metadata['child_note_id']) if metadata.get('child_note_id') else None
    if database_utc(event.updated_at).isoformat() != metadata['source_updated_at'] or not child or database_utc(child.updated_at).isoformat() != metadata['child_updated_at'] or (note and note.version != metadata['child_note_version']):
        raise HTTPException(409, 'Chuỗi hoặc lần đã dời được sửa tiếp. Không thể hoàn tác.')
    before = signature(event, 'event')
    await db.execute(delete(CalendarException).where(CalendarException.event_id == event.id,
        CalendarException.occurrence_at == datetime.fromisoformat(metadata['occurrence_at'])))
    for item in metadata.get('transferred', []):
        exception = await db.get(CalendarException, (child.id, datetime.fromisoformat(item['after'])))
        if not exception: raise HTTPException(409, 'Các lần trong chuỗi đã thay đổi. Không thể hoàn tác.')
        exception.event_id = event.id
        exception.occurrence_at = datetime.fromisoformat(item['before'])
    await db.flush()
    await delete_branch(db, child.id, event.user_id, delete_notes=True)
    event.recurrence_until = datetime.fromisoformat(metadata['previous_until']) if metadata['previous_until'] else None
    await sync_event_jobs(db, event, before=before, allow_elapsed=True)
    await source_changed(db, event)


async def family_move(db, event, target):
    """Apply an all-series time change to related segments and edited instances."""
    from .deletion import recurrence_parent
    root = event.id
    while True:
        parent = await recurrence_parent(db, root, event.user_id)
        if not parent: break
        root = parent
    events, anchors, pending = {}, {}, [root]
    while pending:
        event_id = pending.pop()
        if event_id in events: continue
        item = await db.get(CalendarEvent, event_id)
        events[event_id] = item
        for exception in (await db.scalars(select(CalendarException).where(CalendarException.event_id == event_id,
            CalendarException.replacement_id.is_not(None)))).all():
            anchors[exception.replacement_id] = database_utc(exception.occurrence_at)
            pending.append(exception.replacement_id)
    if len(events) < 2 and not await db.scalar(select(CalendarException.event_id).where(CalendarException.event_id == root).limit(1)): return None
    notifications_only = (datetime.fromisoformat(target['starts_at']) == database_utc(event.starts_at) and datetime.fromisoformat(target['ends_at']) == database_utc(event.ends_at) and target['is_all_day'] == event.is_all_day and (target['recurrence'] == event.recurrence or event.recurrence == 'NONE' and target['recurrence'] == await series_rule(db,event.id,event.recurrence)))
    origin = anchors.get(event.id, database_utc(event.starts_at))
    delta = datetime.fromisoformat(target['starts_at']) - origin if not notifications_only else datetime.fromisoformat(target['starts_at']) - database_utc(event.starts_at)
    duration = datetime.fromisoformat(target['ends_at']) - datetime.fromisoformat(target['starts_at'])
    snapshots = []
    for item in events.values():
        note_id = await db.scalar(select(NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.event_id == item.id))
        note = await db.get(Note, note_id) if note_id else None
        before = signature(item, 'event', not note.is_archived if note else True)
        fields = ('starts_at','ends_at','is_all_day','recurrence','recurrence_until','reminder_minutes','reminder_at')
        saved = {key:database_utc(getattr(item,key)).isoformat() if isinstance(getattr(item,key),datetime) else getattr(item,key) for key in fields}
        if not notifications_only:
            item.starts_at = anchors.get(item.id, database_utc(item.starts_at)) + delta
            item.ends_at = item.starts_at + duration
            item.is_all_day = target['is_all_day']
            if item.recurrence != 'NONE': item.recurrence = target['recurrence']
            if item.recurrence_until: item.recurrence_until = database_utc(item.recurrence_until) + delta
        item.reminder_minutes = target.get('reminder_minutes')
        # Absolute reminders stay one-shot on their existing resource.
        if item.id == event.id:
            item.reminder_at = datetime.fromisoformat(target['reminder_at']) if target.get('reminder_at') else None
        elif item.reminder_minutes is not None: item.reminder_at = None
        await sync_event_jobs(db, item, before=before, active=not note.is_archived if note else True, allow_elapsed=True)
        await source_changed(db, item)
        snapshots.append({'id':item.id, 'before':saved, 'after_updated_at':database_utc(item.updated_at).isoformat(),
            'note_id':note_id, 'note_version':note.version if note else None})
    exceptions = list((await db.scalars(select(CalendarException).where(CalendarException.event_id.in_(events)))).all())
    old_exceptions = []
    for exception in exceptions:
        old = database_utc(exception.occurrence_at)
        old_exceptions.append({'event_id':exception.event_id,'before':old.isoformat(),'after':(old+delta).isoformat(), 'replacement_id':exception.replacement_id})
    await db.execute(delete(CalendarException).where(CalendarException.event_id.in_(events)))
    await db.flush()
    for saved in old_exceptions:
        db.add(CalendarException(event_id=saved['event_id'],occurrence_at=datetime.fromisoformat(saved['after']),replacement_id=saved['replacement_id']))
    await db.flush()
    return {'events':snapshots,'exceptions':old_exceptions}


async def undo_family(db, user_id, metadata):
    for saved in metadata['events']:
        event = await db.get(CalendarEvent,saved['id'])
        note = await db.get(Note,saved['note_id']) if saved['note_id'] else None
        if not event or event.user_id != user_id or database_utc(event.updated_at).isoformat() != saved['after_updated_at'] or (note and note.version != saved['note_version']):
            raise HTTPException(409,'Một phần của chuỗi đã được sửa tiếp. Không thể hoàn tác.')
    for saved in metadata['exceptions']:
        exception=await db.get(CalendarException,(saved.get('after_event_id',saved['event_id']),datetime.fromisoformat(saved['after'])))
        if not exception: raise HTTPException(409,'Các lần trong chuỗi đã thay đổi. Không thể hoàn tác.')
    ids=[saved['id'] for saved in metadata['events']]
    await db.execute(delete(CalendarException).where(CalendarException.event_id.in_(ids)))
    await db.flush()
    for saved in metadata['exceptions']:
        db.add(CalendarException(event_id=saved.get('before_event_id',saved['event_id']),occurrence_at=datetime.fromisoformat(saved['before']),replacement_id=saved['replacement_id']))
    for saved in metadata['events']:
        event=await db.get(CalendarEvent,saved['id'])
        before=signature(event,'event')
        for key,value in saved['before'].items():
            setattr(event,key,datetime.fromisoformat(value) if key in ('starts_at','ends_at','recurrence_until','reminder_at') and value else value)
        await sync_event_jobs(db,event,before=before,allow_elapsed=True)
        await source_changed(db,event)
    await db.flush()


async def move_edited_following(db, event, at, target):
    link=await db.scalar(select(CalendarException).where(CalendarException.replacement_id == event.id))
    if not link or not at or database_utc(at) != database_utc(event.starts_at):
        raise HTTPException(409,'Lần đã chỉnh riêng vừa thay đổi. Hãy mở lại lịch.')
    parent=await db.get(CalendarEvent,link.event_id)
    boundary=database_utc(link.occurrence_at)
    before_until=parent.recurrence_until
    fields=('starts_at','ends_at','is_all_day','recurrence','recurrence_until','reminder_minutes','reminder_at')
    items=[parent,event]
    saved=[]
    for item in items:
        note_id=await db.scalar(select(NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.event_id == item.id))
        saved.append({'id':item.id,'before':{key:database_utc(getattr(item,key)).isoformat() if isinstance(getattr(item,key),datetime) else getattr(item,key) for key in fields},'note_id':note_id})
    exceptions=list((await db.scalars(select(CalendarException).where(CalendarException.event_id.in_([parent.id,event.id])))).all())
    exception_states=[]
    start=datetime.fromisoformat(target['starts_at'])
    delta=start-boundary
    for exception in exceptions:
        original=database_utc(exception.occurrence_at)
        future=exception.event_id == parent.id and original>boundary
        exception_states.append({'event_id':exception.event_id,'before_event_id':exception.event_id,
            'after_event_id':event.id if future else exception.event_id,'before':original.isoformat(),
            'after':(original+delta if future else original).isoformat(),'replacement_id':exception.replacement_id})
    await db.execute(delete(CalendarException).where(CalendarException.event_id.in_([parent.id,event.id])))
    await db.flush()
    for state in exception_states:
        db.add(CalendarException(event_id=state['after_event_id'],occurrence_at=datetime.fromisoformat(state['after']),replacement_id=state['replacement_id']))
    before=signature(event,'event')
    for key,value in target.items():
        setattr(event,key,datetime.fromisoformat(value) if key in ('starts_at','ends_at','reminder_at') and value else value)
    event.recurrence_until=database_utc(before_until)+delta if before_until else None
    await cutoff(db,parent,boundary)
    await sync_event_jobs(db,event,before=before,allow_elapsed=True)
    for item,state in zip(items,saved):
        await source_changed(db,item)
        state['after_updated_at']=database_utc(item.updated_at).isoformat()
        note=await db.get(Note,state['note_id']) if state['note_id'] else None
        state['note_version']=note.version if note else None
    return {'events':saved,'exceptions':exception_states,'scope':'FOLLOWING'}
