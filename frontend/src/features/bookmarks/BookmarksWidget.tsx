import React, { useEffect, useState } from 'react';
import { Bookmark as BookmarkIcon, Plus, Trash2, Globe } from 'lucide-react';
import { api } from '../../services/api';
import { Bookmark } from '../../types';

export const BookmarksWidget: React.FC = () => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const fetchBookmarks = async () => {
    try {
      const data = await api.getBookmarks();
      setBookmarks(data);
    } catch (err) {
      console.error('Lỗi tải liên kết:', err);
    }
  };

  useEffect(() => {
    fetchBookmarks();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    try {
      const created = await api.createBookmark({
        title: title.trim(),
        url: targetUrl,
        category: 'Cá nhân',
      });
      setBookmarks((prev) => [...prev, created]);
      setTitle('');
      setUrl('');
      setShowAdd(false);
    } catch (err) {
      console.error('Lỗi tạo liên kết:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteBookmark(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error('Lỗi xóa liên kết:', err);
    }
  };

  return (
    <div className="glass-panel widget-box" style={{ marginTop: '1.25rem' }}>
      <div className="widget-header">
        <div className="widget-title">
          <BookmarkIcon size={18} className="widget-title-icon" />
          <span>Liên Kết Nhanh (Bookmarks)</span>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowAdd(!showAdd)}
          title="Thêm liên kết"
        >
          <Plus size={14} />
          <span>{showAdd ? 'Đóng' : 'Thêm'}</span>
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleCreate}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            background: 'var(--bg-surface)',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}
        >
          <input
            type="text"
            placeholder="Tên liên kết (vd: Google Drive)..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="form-input"
            style={{ fontSize: '0.8rem', padding: '6px 10px' }}
            required
          />
          <input
            type="text"
            placeholder="Địa chỉ URL (vd: drive.google.com)..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="form-input"
            style={{ fontSize: '0.8rem', padding: '6px 10px' }}
            required
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setShowAdd(false)}
            >
              Hủy
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              Lưu
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
        {bookmarks.map((b) => (
          <div
            key={b.id}
            style={{
              padding: '8px 10px',
              background: 'var(--bg-card-solid)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
            }}
          >
            <a
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-main)',
                textDecoration: 'none',
                fontSize: '0.8rem',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
              title={b.url}
            >
              <Globe size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</span>
            </a>
            {!b.is_global && (
              <button
                type="button"
                onClick={() => handleDelete(b.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '2px',
                }}
                title="Xóa liên kết"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
