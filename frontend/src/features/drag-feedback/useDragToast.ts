import { HTMLAttributes, useCallback, useEffect, useId, useRef, useState } from 'react';
const OPEN = 'dtl:drag-toast-open';

export function useDragToast<T>(pending = false) {
  const owner = useId();
  const [notice, setState] = useState<T>(), [paused, setPaused] = useState(false);
  const ownerRef = useRef(owner);
  useEffect(() => {
    const opened = (event: Event) => { if ((event as CustomEvent<string>).detail !== ownerRef.current) { setState(undefined); setPaused(false); } };
    window.addEventListener(OPEN, opened);
    return () => window.removeEventListener(OPEN, opened);
  }, []);
  const setNotice = useCallback((value: T | undefined) => {
    if (value !== undefined) window.dispatchEvent(new CustomEvent(OPEN, { detail: ownerRef.current }));
    setPaused(false); setState(value);
  }, []);
  useEffect(() => { if (notice === undefined || paused || pending) return; const timer = window.setTimeout(() => setNotice(undefined), 6000); return () => clearTimeout(timer); }, [notice, paused, pending, setNotice]);
  const hoverProps: HTMLAttributes<HTMLDivElement> = { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false), onFocus: () => setPaused(true), onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); } };
  return { notice, setNotice, hoverProps };
}
