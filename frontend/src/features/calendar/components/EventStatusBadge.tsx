import { eventStatus, EVENT_STATUSES } from '../eventStatus';
import { CSSProperties } from 'react';

export function EventStatusBadge({ status }: { status: ReturnType<typeof eventStatus> }) {
  return <span className="calendar-event-status"><span className="calendar-event-dot" />{status.label}</span>;
}

export function EventStatusLegend() {
  return <div className="calendar-status-legend" aria-label="Màu trạng thái sự kiện">
    {Object.entries(EVENT_STATUSES).map(([key, status]) => <span key={key} style={{ '--event-color': status.color } as CSSProperties}><span className="calendar-event-dot" />{status.label}</span>)}
  </div>;
}
