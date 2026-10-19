import { useInvalidation } from '../../realtime/useInvalidation';
import { useEffect, useRef, useState } from 'react';
import { calendarApi } from '../api';
import { CalendarEvent, CalendarEventInput } from '../types';
import { WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';
import { CreateAttempt } from '../../../services/mutationRecovery';

export function useCalendarEvents(start: string, end: string, includeEvents = true, includeNotes = true) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [eventTotal, setEventTotal] = useState(0), [noteTotal, setNoteTotal] = useState(0);
  const [total, setTotal] = useState(0), [truncated, setTruncated] = useState(false);
  const [revision, refresh] = useInvalidation();
  const previousRange = useRef('');
  useEffect(() => {
    const onChange = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('calendar')) refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, onChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED, onChange);
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const rangeKey = `${start}/${end}`;
    if (previousRange.current !== rangeKey) { setEvents([]); setTotal(0); setEventTotal(0); setNoteTotal(0); setTruncated(false); }
    previousRange.current = rangeKey;
    calendarApi.list(start, end, controller.signal, includeEvents, includeNotes)
      .then(data => { if (!controller.signal.aborted) { setEvents(data.items); setTotal(data.total); setEventTotal(data.event_total); setNoteTotal(data.note_total); setTruncated(data.truncated); } })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không thể tải lịch.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [start, end, revision, includeEvents, includeNotes]);

  const save = async (payload: CalendarEventInput, id?: string, attempt?: CreateAttempt<CalendarEventInput>) => {
    try {
      if (id) await calendarApi.update(id, payload);
      else { if (!attempt) throw new Error('Thiếu mã yêu cầu tạo sự kiện.'); await calendarApi.create(payload, attempt); }
    } finally { refresh(); }
  };

  const remove = async (id: string, updatedAt: string) => {
    try { await calendarApi.remove(id, updatedAt); } finally { refresh(); }
  };

  return { events, total, eventTotal, noteTotal, truncated, loading, error, refresh, save, remove };
}
