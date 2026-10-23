export function EventContinuationMarker({ direction, label, inline = false }: { direction: 'start' | 'end'; label: string; inline?: boolean }) {
  const path = inline
    ? direction === 'start' ? 'M14 6H2 M6 2L2 6L6 10' : 'M2 6H14 M10 2L14 6L10 10'
    : direction === 'start' ? 'M6 14V2 M2 6L6 2L10 6' : 'M6 2V14 M2 10L6 14L10 10';
  return <span className={`calendar-continuation-marker is-${direction}${direction === 'end' && !inline ? ' calendar-event-continues-next' : ''}${inline ? ' is-inline calendar-all-day-continuation' : ''}`} role="img" aria-label={label} data-tooltip={label}>
    <svg viewBox={inline ? '0 0 16 12' : '0 0 12 16'} preserveAspectRatio="none" aria-hidden="true" fill="none">
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  </span>;
}
