import { useCallback, useEffect, useRef, useState } from 'react';
// Local writes and SSE usually describe the same transaction. Coalesce their reads.
export function useInvalidation() {
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const invalidate = useCallback(() => { if (timer.current !== undefined) return; timer.current = setTimeout(() => { timer.current = undefined; setRevision(value => value + 1); }, 80); }, []);
  useEffect(() => () => { clearTimeout(timer.current); timer.current = undefined; }, []);
  return [revision, invalidate] as const;
}
