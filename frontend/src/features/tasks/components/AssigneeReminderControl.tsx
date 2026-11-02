import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../../types';
import { requestWithTimeout } from '../../../services/requestTimeout';
import { ApiError } from '../../../services/api';
import { ReminderFields, reminderValue, sameReminder, type ReminderValue } from '../../reminders/ReminderFields';
import { parseDate, toTimestamp } from '../../calendar/dateUtils';
import { WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';

interface Selection extends ReminderValue {
  version: number; task_version: number; has_override: boolean; due_date: string | null; due_time: string | null;
}

export function AssigneeReminderControl({ task, disabled, onBusyChange, onSaved }: {
  task: Task; disabled?: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void;
}) {
  const submitting = useRef(false), mounted = useRef(true);
  const [selection, setSelection] = useState<Selection>(), [value, setValue] = useState<ReminderValue>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const path = `/api/tasks/${encodeURIComponent(task.id)}/personal-reminder`;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setSelection(undefined);
    requestWithTimeout<Selection>(path, { cache: 'no-store', signal: controller.signal })
      .then(saved => { if (!controller.signal.aborted) { setSelection(saved); setValue(reminderValue(saved)); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [path, retry]);
  const save = async () => {
    if (!selection || submitting.current || disabled || sameReminder(value, selection)) return;
    submitting.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      await requestWithTimeout<Selection>(path, { method: 'PUT', body: JSON.stringify({ ...reminderValue(value),
        expected_version: selection.version, expected_task_version: selection.task_version }) });
      if (mounted.current) {
        window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: ['tasks', 'notifications'] }));
        onSaved();
      }
    } catch (reason) {
      if (mounted.current) {
        setError(reason instanceof Error ? reason.message : 'Chưa lưu được thông báo riêng.');
        if (reason instanceof ApiError && reason.status === 409) {
          try {
            const fresh = await requestWithTimeout<Selection>(path, { cache: 'no-store' });
            if (mounted.current) { setSelection(fresh); setError('Thông tin vừa thay đổi. Đã tải hạn mới; lựa chọn của bạn được giữ. Hãy kiểm tra rồi áp dụng lại.'); }
          } catch { /* Keep the current draft and original conflict message. */ }
        }
      }
    }
    finally { submitting.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  };
  return <section className="task-personal-reminder" aria-label="Thông báo của tôi" aria-busy={busy}>
    {!selection && !error && <p role="status">Đang tải thông báo đã thiết lập…</p>}
    {selection && <><ReminderFields heading="Thông báo riêng" value={value} onChange={next => { setValue(next); setError(''); }} disabled={busy || disabled} allowUnscheduled allDay={!selection.due_time}
      anchor={selection.due_date ? toTimestamp(parseDate(selection.due_date), selection.due_time || '00:00') : null} />
      <p className="task-personal-reminder-hint">Chỉ áp dụng cho bạn</p></>}
    {error && <p className="alert-error" role="alert">{error}{!selection && <button type="button" className="btn btn-outline btn-sm" onClick={() => setRetry(v => v + 1)}>Thử lại</button>}</p>}
    {selection && <div className="task-personal-reminder-actions"><button type="button" className="btn btn-primary btn-sm"
      disabled={busy || disabled || sameReminder(value, selection)} onClick={() => { void save(); }}>{busy ? 'Đang lưu…' : 'Áp dụng'}</button></div>}
  </section>;
}
