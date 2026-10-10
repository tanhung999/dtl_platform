import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Pin, Trash2 } from 'lucide-react';
import { Note } from '../../types';

interface NoteModalProps {
  note: Partial<Note> | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: { title: string; content: string; color: string; is_pinned: boolean }) => void;
  onDelete?: (id: string) => void;
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
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState('#fef08a');
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    if (note) {
      setTitle(note.title || '');
      setContent(note.content || '');
      setColor(note.color || '#fef08a');
      setIsPinned(Boolean(note.is_pinned));
    } else {
      setTitle('');
      setContent('');
      setColor('#fef08a');
      setIsPinned(false);
    }
  }, [note, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title: title.trim() || 'Ghi chú',
      content: content.trim(),
      color,
      is_pinned: isPinned,
    });
    onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
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
                color: isPinned ? 'white' : '#64748b',
                padding: '4px 8px',
              }}
              onClick={() => setIsPinned(!isPinned)}
              title={isPinned ? 'Bỏ ghim' : 'Ghim ghi chú'}
            >
              <Pin size={14} />
              <span>{isPinned ? 'Đã ghim' : 'Ghim'}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <input
              type="text"
              placeholder="Tiêu đề ghi chú..."
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
          </div>

          <div
            className="modal-footer"
            style={{
              background: 'rgba(255,255,255,0.4)',
              borderTopColor: 'rgba(0,0,0,0.08)',
              justifyContent: 'space-between',
            }}
          >
            <div>
              {note?.id && onDelete && (
                <button
                  type="button"
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => {
                    onDelete(note.id!);
                    onClose();
                  }}
                  title="Xóa ghi chú"
                >
                  <Trash2 size={14} />
                  <span>Xóa</span>
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
                Hủy
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Lưu ghi chú
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
