import { useLayoutEffect, useRef } from 'react';

export function useListMotion(ids: string[], attribute: 'data-task-id' | 'data-sort-id') {
  const ref = useRef<HTMLDivElement>(null), previous = useRef(new Map<string, DOMRect>());
  const key = ids.join('|');
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    ref.current?.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach(node => {
      const id = node.getAttribute(attribute)!, rect = node.getBoundingClientRect(), old = previous.current.get(id);
      next.set(id, rect);
      if (old && !node.classList.contains('is-dragging') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const x = old.left - rect.left, y = old.top - rect.top;
        if (Math.abs(x) + Math.abs(y) > 1) node.animate([{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }], { duration: 180, easing: 'ease-out' });
      }
    });
    previous.current = next;
  }, [key, attribute]);
  return ref;
}
