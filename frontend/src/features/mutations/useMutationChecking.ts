import { useEffect, useState } from 'react';
export function useMutationChecking() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const change = (event: Event) => setPending(value => Math.max(0, value + ((event as CustomEvent<boolean>).detail ? 1 : -1)));
    window.addEventListener('mutation:checking', change);
    return () => window.removeEventListener('mutation:checking', change);
  }, []);
  return pending > 0;
}
