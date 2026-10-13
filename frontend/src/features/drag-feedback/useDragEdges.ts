import { RefObject, useEffect, useRef, useState } from 'react';
import { addDays } from '../calendar/dateUtils';
import { useDragFeedback } from './DragFeedbackProvider';
import { REVERT_DRAG_VIEW } from './dragFeedbackEvents';

export function useDragEdges(ref: RefObject<HTMLElement>, date: Date, onChange: (date: Date) => void, gutter = 0) {
  const feedback = useDragFeedback(), [edge, setEdge] = useState<string>();
  const current = useRef({ date, onChange }); current.current = { date, onChange };
  const restore = useRef<{ id: string; date: Date; onChange: (date: Date) => void; moved: boolean }>();
  const key = feedback.source?.dragId;
  useEffect(() => {
    const revert = (event: Event) => { if (restore.current?.id === (event as CustomEvent<string>).detail && restore.current.moved) { restore.current.onChange(restore.current.date); restore.current.moved = false; } };
    window.addEventListener(REVERT_DRAG_VIEW, revert);
    return () => window.removeEventListener(REVERT_DRAG_VIEW, revert);
  }, []);
  useEffect(() => {
    if (!key) { setEdge(undefined); return; }
    restore.current = { id: key, ...current.current, moved: false };
    let frame = 0, direction = 0, entered = 0, scrollEdge: string | undefined, scrollEntered = 0;
    const tick = (time: number) => {
      const node = ref.current, point = feedback.pointer.current;
      let nextDirection = 0; let nextEdge: string | undefined;
      if (node && point) {
        const rect = node.getBoundingClientRect(), first = rect.left + gutter, band = Math.min(20, (rect.width - gutter) / 28);
        const headerBottom = node.querySelector('.calendar-week-header')?.getBoundingClientRect().bottom ?? rect.top;
        const inY = point.y >= headerBottom && point.y <= rect.bottom;
        if (inY && point.x >= first && point.x <= first + band) { nextEdge = 'left'; if (!gutter || node.scrollLeft <= 1) nextDirection = -1; else node.scrollLeft -= 3; }
        else if (inY && point.x <= rect.right && point.x >= rect.right - band) { nextEdge = 'right'; if (!gutter || node.scrollLeft >= node.scrollWidth - node.clientWidth - 1) nextDirection = 1; else node.scrollLeft += 3; }
        else if (point.x >= first && point.x <= rect.right && node.scrollHeight > node.clientHeight) {
          const top = node.querySelector('.calendar-week-all-day')?.getBoundingClientRect().bottom ?? rect.top;
          if (point.y >= top && point.y <= top + 28 && node.scrollTop > 0) nextEdge = 'top';
          else if (point.y <= rect.bottom && point.y >= rect.bottom - 28 && node.scrollTop < node.scrollHeight - node.clientHeight - 1) nextEdge = 'bottom';
        }
        if (nextEdge !== scrollEdge) { scrollEdge = nextEdge; scrollEntered = time; }
        if (time - scrollEntered >= 180) { if (nextEdge === 'top') node.scrollTop -= 2; else if (nextEdge === 'bottom') node.scrollTop += 2; }
      }
      setEdge(value => value === nextEdge ? value : nextEdge);
      if (nextDirection !== direction) { direction = nextDirection; entered = time; }
      if (direction && time - entered >= 700) { current.current.onChange(addDays(current.current.date, direction * 7)); if (restore.current) restore.current.moved = true; entered = time; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, ref, gutter, feedback.pointer]);
  return edge;
}
