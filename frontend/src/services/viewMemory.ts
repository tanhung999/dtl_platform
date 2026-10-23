import { Dispatch, RefObject, SetStateAction, useEffect, useLayoutEffect, useState } from 'react';
import { getStoredUser } from './api';

const keyFor = (name: string) => `dtl_view:${getStoredUser()?.id ?? 'guest'}:${name}`;
function read<T>(key: string, fallback: () => T, valid: (value: unknown) => boolean): T {
  try { const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (valid(value)) return value as T; } catch { /* Optional view memory. */ }
  return fallback();
}
function write(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be disabled. */ } }
export function useViewMemory<T>(name: string, fallback: () => T, valid: (value: unknown) => boolean): [T, Dispatch<SetStateAction<T>>] {
  const key = keyFor(name);
  const [value, setValue] = useState<T>(() => read(key, fallback, valid));
  useEffect(() => { write(key, value); }, [key, value]);
  return [value, setValue];
}
const validScroll = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000000;
export function useScrollMemory(ref: RefObject<HTMLElement>, name: string, initial = 0) {
  const key = keyFor(`scroll:${name}`);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.scrollTop = read(key, () => initial, validScroll);
    let frame = 0;
    const save = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => write(key, node.scrollTop)); };
    node.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(frame); node.removeEventListener('scroll', save); write(key, node.scrollTop); };
  }, [key, ref, initial]);
}

export function useWindowScrollMemory(name: string, ready: boolean) {
  const key = keyFor(`scroll:${name}`);
  useEffect(() => {
    if (!ready) return;
    const top = read(key, () => 0, validScroll);
    let listening = false, pendingSave = 0;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top, behavior: 'instant' }); listening = true;
    });
    const save = () => { if (listening && !pendingSave) pendingSave = requestAnimationFrame(() => { pendingSave = 0; write(key, window.scrollY); }); };
    window.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(pendingSave); window.removeEventListener('scroll', save); if (listening) write(key, window.scrollY); };
  }, [key, ready]);
}

export const isText = (value: unknown) => typeof value === 'string' && value.length <= 200;
export const isOffset = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000000;
export const isDay = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
