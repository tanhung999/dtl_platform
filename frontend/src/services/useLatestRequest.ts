import { useCallback, useEffect, useRef } from 'react';

// Starting another action or closing its UI invalidates late responses as well as the transport.
export function useLatestRequest() {
  const current = useRef<AbortController>();
  const cancel = useCallback(() => { current.current?.abort(); }, []);
  const start = useCallback(() => {
    cancel();
    const controller = new AbortController();
    current.current = controller;
    return controller;
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  return { start, cancel };
}
