import { CalendarDays, Lock, StickyNote } from 'lucide-react';
import { CalendarEvent } from '../types';

export function calendarItemType(event: CalendarEvent): string {
  return event.scheduled_note_id ? 'Ghi chú' : 'Sự kiện';
}

export function CalendarItemTitle({ event, compact = false, continuation }: { event: CalendarEvent; compact?: boolean; continuation?: string }) {
  const Icon = event.scheduled_note_id ? StickyNote : CalendarDays;
  return <span className="calendar-item-title">
    {continuation && <span className="calendar-event-continuation" role="img" aria-label={continuation} title={continuation}>↑</span>}
    {event.is_private && <Lock size={12} aria-label="Riêng tư" />}
    <Icon className="calendar-item-icon" size={14} role="img" aria-label={calendarItemType(event)} />
    <span className="calendar-item-name">{event.title}</span>
    {event.scheduled_note_id && !compact && <span className="calendar-note-label" aria-hidden="true">Ghi chú</span>}
  </span>;
}
