import { useLayoutEffect, useRef } from 'react';

// Keep the fixed weekday/all-day grids aligned with the scrollable hour grid.
export function useCalendarTimeline() {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const update = () => node.parentElement?.style.setProperty('--calendar-scrollbar-width', `${node.offsetWidth - node.clientWidth}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return scroll;
}
