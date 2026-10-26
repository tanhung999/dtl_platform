import { useInvalidation } from '../../realtime/useInvalidation';
import { useCallback, useEffect } from 'react';
import { useRangeCollection } from '../../../services/useRangeCollection';
import { calendarApi, EventRange } from '../api';
import { CalendarEvent, CalendarEventInput } from '../types';
import { WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';
import { CreateAttempt } from '../../../services/mutationRecovery';

export function useCalendarEvents(start: string, end: string, includeEvents = true, includeNotes = true) {
  const [revision, refresh] = useInvalidation();
  const fetchPage = useCallback((offset: number, signal: AbortSignal) => calendarApi.list(start, end, signal, includeEvents, includeNotes, offset), [start, end, includeEvents, includeNotes]);
  const data = useRangeCollection<CalendarEvent, EventRange>(`calendar/${start}/${end}/${includeEvents}/${includeNotes}`, revision, fetchPage);
  useEffect(() => {
    const onChange = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('calendar')) refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, onChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED, onChange);
  }, [refresh]);

  const save = async (payload: CalendarEventInput, id?: string, attempt?: CreateAttempt<CalendarEventInput>) => {
    try {
      if (id) await calendarApi.update(id, payload);
      else { if (!attempt) throw new Error('Thiếu mã yêu cầu tạo sự kiện.'); await calendarApi.create(payload, attempt); }
    } finally { refresh(); }
  };

  const remove = async (id: string, updatedAt: string, selection?: import("../components/RecurrenceScope").ScopeSelection) => {
    try { await calendarApi.remove(id, updatedAt, selection); } finally { refresh(); }
  };

  return { ...data, events: data.items, eventTotal: data.page?.event_total ?? 0, noteTotal: data.page?.note_total ?? 0, refresh, save, remove };
}
