import { PrivacyToggle } from '../access/PrivacyToggle';
import { RescheduleControl } from '../rescheduling/RescheduleControl';
import { NoteScheduleFields, initialNoteSchedule } from '../note-scheduling/NoteScheduleFields';
import { NoteSchedule } from '../note-scheduling/types';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Pin, Trash2, Archive } from 'lucide-react';
import { Note } from '../../types';
import { NoteCreateAttempt } from './createNote';
import { DeleteNoteDialog } from './DeleteNoteDialog';
import { ApiError } from '../../services/api';
import { notesApi } from './api';
import { NoteWrite } from './types';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import './notes.css';
import { sameFields, sameSchedule } from '../../services/unchanged';
import { reminderValue } from '../reminders/ReminderFields';

interface NoteModalProps {
  note: Partial<Note> | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: NoteWrite, attempt?: NoteCreateAttempt) => Promise<void>;
  onDelete?: (id: string, verifyOnly?: boolean, expectedVersion?: number) => Promise<void>;
  onArchive?: (id: string, expectedVersion: number, payload: NoteWrite) => Promise<void>;
}

const PASTEL_COLORS = [
  { name: 'Vàng', hex: '#fef08a' },
  { name: 'Xanh Lá', hex: '#bbf7d0' },
  { name: 'Xanh Biển', hex: '#bfdbfe' },
  { name: 'Hồng', hex: '#fbcfe8' },
  { name: 'Tím', hex: '#e9d5ff' },
  { name: 'Trắng', hex: '#ffffff' },
];

export const NoteModal: React.FC<NoteModalProps> = ({
  note,
  isOpen,
  onClose,
  onSave,
  onDelete,
  onArchive,
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [remote, setRemote] = useState(false);
  const version = useRef(note?.version ?? 0);
  const creationAttempt = useRef<NoteCreateAttempt>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState('#fef08a');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [schedule, setSchedule] = useState<NoteSchedule>();
  const [savedSchedule, setSavedSchedule] = useState<NoteSchedule>();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const savedFields = useRef<Record<string, unknown>>({});
  const editableFields = (value: Partial<Note> | null) => ({ title: value?.title?.trim() || 'Ghi chú', content: value?.content?.trim() || '',
    color: value?.color || '#fef08a', is_pinned: !!value?.is_pinned, is_private: !!value?.is_private });

  useEffect(() => {
    creationAttempt.current = undefined;
    savedFields.current = editableFields(note);
    setSchedule(note?.calendar_schedule ?? undefined); setScheduleOpen(!!note?.calendar_schedule);
    setSavedSchedule(note?.calendar_schedule ?? undefined);
    version.current = note?.version ?? 0; setError(''); setRemote(false); setConfirmDelete(false);
    if (note) {
      setTitle(note.title || '');
      setContent(note.content || '');
      setColor(note.color || '#fef08a');
      setIsPinned(Boolean(note.is_pinned));
      setIsPrivate(Boolean(note.is_private));
    } else {
      setTitle('');
      setContent('');
      setColor('#fef08a');
      setIsPinned(false); setIsPrivate(false);
    }
  }, [note, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    mounted.current = true;
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { mounted.current = false; element?.close(); previousFocus?.focus(); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !note?.id) return;
    let live = true, requestId = 0;
    const changed = async (event?: Event) => {
      if (event?.type === WORKSPACE_CHANGED && !(event as CustomEvent<string[]>).detail.includes('notes')) return;
      const id = ++requestId;
      try {
        const updated = await notesApi.get(note.id!);
        if (live && id === requestId && updated.version !== version.current) { setRemote(true); }
      } catch (reason) { if (live && reason instanceof ApiError && reason.status === 404) setError('Ghi chú đã bị xóa hoặc lưu trữ. Bạn có thể sao chép bản nháp trước khi đóng.'); }
    };
    window.addEventListener(WORKSPACE_CHANGED, changed); window.addEventListener('focus', changed);
    void changed();
    return () => { live = false; window.removeEventListener(WORKSPACE_CHANGED, changed); window.removeEventListener('focus', changed); };
  }, [isOpen, note?.id]);

  if (!isOpen) return null;
  const hasSavedSchedule = !!(note?.id && savedSchedule?.event_id && savedSchedule.expected_updated_at);

  const buildPayload = (): NoteWrite => {
    if (dialog.current?.querySelector('form')?.reportValidity() === false) throw new Error('Vui lòng kiểm tra lại ngày giờ đang nhập.');
    if (scheduleOpen && schedule && Date.parse(schedule.ends_at) <= Date.parse(schedule.starts_at)) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
    return { ...(scheduleOpen && schedule ? { calendar_schedule: schedule } : {}), title: title.trim() || 'Ghi chú', content: content.trim(), color, is_pinned: isPinned, is_private: isPrivate, ...(note?.id ? { expected_version: version.current } : {}) };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); e.stopPropagation(); if (busy) return;
    setBusy(true); setError('');
    try {
      const payload = buildPayload();
      const { calendar_schedule, expected_version, ...fields } = payload;
      if (note?.id && sameFields(fields, savedFields.current) && sameSchedule(calendar_schedule, savedSchedule)) { onClose(); return; }
      if (!note?.id) creationAttempt.current ??= { requestId: crypto.randomUUID(), original: { ...payload } };
      await onSave(payload, creationAttempt.current);
      if (mounted.current) onClose();
    } catch (reason) {
      if (!mounted.current) return;
      if (!note?.id && reason instanceof ApiError && [400, 404, 422].includes(reason.status)) creationAttempt.current = undefined;
      setError(reason instanceof Error ? reason.message : 'Không thể lưu ghi chú. Bản nháp vẫn được giữ.');
      if (note?.id && reason instanceof ApiError && reason.status === 409) {
        setRemote(true);
      }
    } finally { if (mounted.current) setBusy(false); }
  };

  return createPortal(
    <><dialog ref={dialog} className="note-editor-dialog" aria-label="Ghi chú" onCancel={e => { e.preventDefault(); e.stopPropagation(); }}>
      <div
        className="modal-content"
        style={{ backgroundColor: color }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ borderBottomColor: 'rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{
                background: isPinned ? '#2563eb' : 'transparent',
                color: isPinned ? 'white' : '#475569',
                padding: '4px 8px',
              }}
              disabled={busy}
              onClick={() => setIsPinned(!isPinned)}
              title={isPinned ? 'Bỏ ghim' : 'Ghim ghi chú'}
            >
              <Pin size={14} />
              <span>{isPinned ? 'Đã ghim' : 'Ghim'}</span>
            </button>
          </div>
          <button
            type="button"
            aria-label="Đóng ghi chú"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
          >
            <X size={18} />
          </button>
        </div>

        {remote && <div className="note-editor-message" role="status">Ghi chú đã được cập nhật ở nơi khác. Bản nháp của bạn được giữ nguyên. <button type="button" disabled={busy} onClick={async () => {
          setBusy(true); try { const value = await notesApi.get(note!.id!); savedFields.current = editableFields(value); setTitle(value.title); setContent(value.content); setColor(value.color); setIsPinned(value.is_pinned); setIsPrivate(value.is_private ?? false); setSchedule(value.calendar_schedule ?? undefined); setSavedSchedule(value.calendar_schedule ?? undefined); setScheduleOpen(!!value.calendar_schedule); version.current = value.version; setRemote(false); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không tải được bản mới.'); } finally { setBusy(false); }
        }}>Bỏ bản nháp, tải bản mới</button></div>}
        {error && <p className="note-editor-message" role="alert">{error}</p>}
        <form onSubmit={handleSubmit}>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="modal-body">
            <input
              type="text"
              placeholder="Tiêu đề ghi chú..."
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                border: 'none',
                background: 'transparent',
                color: '#0f172a',
                outline: 'none',
                width: '100%',
                padding: '4px 0',
              }}
              autoFocus
            />

            <textarea
              placeholder="Nhập nội dung ghi chú ở đây..."
              maxLength={50000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              style={{
                fontSize: '0.875rem',
                border: 'none',
                background: 'transparent',
                color: '#1e293b',
                outline: 'none',
                width: '100%',
                resize: 'vertical',
                lineHeight: 1.5,
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Màu sắc:</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                {PASTEL_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColor(c.hex)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      backgroundColor: c.hex,
                      border: color === c.hex ? '2px solid #0f172a' : '1px solid #cbd5e1',
                      cursor: 'pointer',
                    }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          <PrivacyToggle label="Ghi chú riêng tư" value={isPrivate} onChange={setIsPrivate} />

            {!note?.is_archived && <>
              {!hasSavedSchedule && !scheduleOpen && <div className="note-schedule-actions"><button type="button" className="btn btn-outline btn-sm" disabled={!!creationAttempt.current} aria-expanded={scheduleOpen} onClick={() => { setSchedule(value => value ?? initialNoteSchedule()); setScheduleOpen(true); }}>Gắn vào lịch</button></div>}
              {scheduleOpen && schedule && <><fieldset disabled={!!creationAttempt.current} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><NoteScheduleFields value={schedule} onChange={setSchedule} scheduleReadOnly={hasSavedSchedule} scheduleAction={hasSavedSchedule && savedSchedule && !note?.is_archived && <RescheduleControl kind="note" id={note!.id!} title={note?.title || 'Ghi chú không có tiêu đề'} current={savedSchedule} version={version.current} updatedAt={savedSchedule.expected_updated_at} disabled={busy} onMoved={change => {
            const value: NoteSchedule = { starts_at: change.after.starts_at!, ends_at: change.after.ends_at!, is_all_day: !!change.after.is_all_day, event_id: change.guard.event_id!, expected_updated_at: change.guard.expected_updated_at!, ...reminderValue(change.after) };
            version.current = change.guard.expected_version!; setSchedule(value); setSavedSchedule(value); setScheduleOpen(true); setRemote(false);
          }}/>} /></fieldset>{!schedule.event_id && <button type="button" className="btn btn-outline btn-sm" disabled={!!creationAttempt.current} onClick={() => { setScheduleOpen(false); setSchedule(undefined); }}>Bỏ chọn lịch</button>}</>}
            </>}
          </div>

          <div
            className="modal-footer"
            style={{
              borderTopColor: 'rgba(0,0,0,0.08)',
              justifyContent: 'space-between',
            }}
          >
            <div className="note-editor-secondary-actions">
              {note?.id && onArchive && !note.is_archived && <button type="button" className="btn btn-outline btn-sm" onClick={async () => {
                setBusy(true); setError('');
                try { await onArchive(note.id!, version.current, buildPayload()); if (mounted.current) onClose(); } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : 'Không thể lưu trữ.'); if (reason instanceof ApiError && reason.status === 409) setRemote(true); } } finally { if (mounted.current) setBusy(false); }
              }}><Archive size={14} /> Lưu trữ</button>}
              {note?.id && onDelete && (
                <button
                  type="button"
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => setConfirmDelete(true)}
                  title="Xóa ghi chú"
                >
                  <Trash2 size={14} />
                  <span>Xóa ghi chú</span>
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary btn-sm">
                Lưu ghi chú
              </button>
            </div>
          </div>
          </fieldset>
        </form>
      </div>
    </dialog>
    {confirmDelete && note?.id && onDelete && <DeleteNoteDialog note={{ id: note.id, title: note.title }} onClose={() => setConfirmDelete(false)} onDelete={async (verifyOnly, expectedVersion) => { await onDelete(note.id!, verifyOnly, expectedVersion); if (mounted.current) { setConfirmDelete(false); onClose(); } }} />}
    </>,
    document.body
  );
};
