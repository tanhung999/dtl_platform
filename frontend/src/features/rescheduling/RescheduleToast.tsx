import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Change, notifyMoved, undo } from './api';
import { scheduleLabel } from './labels';
import './rescheduling.css';

export function showMoved(change: Change) { window.dispatchEvent(new CustomEvent('schedule:moved', { detail: change })); }
export function RescheduleToast() {
  const panel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const [host, setHost] = useState<Element>(document.body);
  const [change, setChange] = useState<Change>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const received = (event: Event) => { generation.current++; setChange((event as CustomEvent<Change>).detail); setError(''); setBusy(false); };
    window.addEventListener('schedule:moved', received); return () => window.removeEventListener('schedule:moved', received); }, []);
  useEffect(() => { if (!change || busy || error) return; const current = generation.current; const timer = setTimeout(() => { if (generation.current === current) setChange(undefined); }, 6000); return () => clearTimeout(timer); }, [change, busy, error]);
  useEffect(() => {
    if (!change) return;
    // A modal makes nodes outside its DOM subtree inert, even at a higher z-index.
    // Follow the active dialog so Undo remains usable, then return to body on close.
    const place = () => { const dialogs = document.querySelectorAll('dialog[open]'); setHost(dialogs.item(dialogs.length - 1) || document.body); };
    place(); const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, [change]);
  useEffect(() => { if (!change || !panel.current) return; const node = panel.current as HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void };
    if (!node.isConnected) return;
    node.setAttribute('popover', 'manual'); node.showPopover?.(); return () => node.hidePopover?.(); }, [change, host]);
  if (!change) return null;
  return createPortal(<div ref={panel} className={`reschedule-toast ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}>
    <span>{error || `Đã ${change.kind === 'task' ? 'đổi hạn' : 'dời lịch'} sang ${scheduleLabel(change.after)}`}</span>
    {!error && <button type="button" disabled={busy} onClick={async () => { const current = generation.current; setBusy(true); try { const result = await undo(change.id); window.dispatchEvent(new CustomEvent('schedule:undone', { detail: result })); notifyMoved(change.kind); if (generation.current === current) setChange(undefined); } catch (reason) { if (generation.current === current) setError((reason as Error).message); } finally { if (generation.current === current) setBusy(false); } }}>{busy ? 'Đang hoàn tác…' : 'Hoàn tác'}</button>}
    <button type="button" aria-label="Đóng thông báo dời lịch" disabled={busy} onClick={() => setChange(undefined)}><X size={15}/></button>
  </div>, host);
}
