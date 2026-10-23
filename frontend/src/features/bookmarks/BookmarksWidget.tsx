import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark as BookmarkIcon, Plus, Trash2, Globe } from 'lucide-react';
import { bookmarksApi } from './api';
import { bookmarkUrl } from './bookmarkUrl';
import { Bookmark } from '../../types';
import { ApiError } from '../../services/api';
import { useLatestRequest } from '../../services/useLatestRequest';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';

export function BookmarksWidget() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState(''), [url, setUrl] = useState('');
  const [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false), [deleting, setDeleting] = useState('');
  const attempt = useRef<{ title: string; url: string; category: string; client_request_id: string }>();
  const mutating = useRef(false), mounted = useRef(true);
  const { start, cancel } = useLatestRequest();
  const fetchBookmarks = useCallback(async () => {
    const controller = start(); setLoading(true);
    try {
      const data = await bookmarksApi.getBookmarks(controller.signal);
      if (!controller.signal.aborted) { setBookmarks(data); setLoadError(''); }
    } catch (reason) { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : 'Không thể tải liên kết.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [start]);
  useEffect(() => {
    mounted.current = true; void fetchBookmarks();
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('bookmarks')) void fetchBookmarks(); };
    window.addEventListener(WORKSPACE_CHANGED, changed);
    return () => { mounted.current = false; cancel(); window.removeEventListener(WORKSPACE_CHANGED, changed); };
  }, [fetchBookmarks, cancel]);
  const handleCreate = async (event: FormEvent) => {
    event.preventDefault(); if (mutating.current || !title.trim() || !url.trim()) return;
    try { attempt.current ??= { title: title.trim(), url: bookmarkUrl(url), category: 'Cá nhân', client_request_id: crypto.randomUUID() }; }
    catch (reason) { setError((reason as Error).message); return; }
    mutating.current = true; setSaving(true); setError('');
    try {
      await bookmarksApi.createBookmark(attempt.current);
      if (!mounted.current) return;
      attempt.current = undefined; setTitle(''); setUrl(''); setShowAdd(false); void fetchBookmarks();
    } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof ApiError && [400, 404, 410, 422].includes(reason.status)) attempt.current = undefined;
      setError(reason instanceof Error ? reason.message : 'Không thể lưu liên kết.');
    } finally { mutating.current = false; if (mounted.current) setSaving(false); }
  };
  const handleDelete = async (id: string) => {
    if (mutating.current) return;
    mutating.current = true; setDeleting(id); setError('');
    try {
      try { await bookmarksApi.deleteBookmark(id); }
      catch (reason) { if (!(reason instanceof ApiError && reason.status === 404)) throw reason; }
      if (mounted.current) void fetchBookmarks();
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Không thể xóa liên kết.'); }
    finally { mutating.current = false; if (mounted.current) setDeleting(''); }
  };
  const busy = saving || !!deleting;
  const visibleError = error || loadError;
  return <div className="glass-panel widget-box bookmarks-widget">
    <div className="widget-header"><div className="widget-title"><BookmarkIcon size={18} className="widget-title-icon" /><span>Liên kết nhanh (Bookmarks)</span></div>
      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setShowAdd(!showAdd)} title="Thêm liên kết"><Plus size={14} /><span>{showAdd ? 'Đóng' : 'Thêm'}</span></button>
    </div>
    {visibleError && <div className="alert-error" role="alert">{visibleError}<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { setError(''); void fetchBookmarks(); }}>Tải lại danh sách</button></div>}
    {showAdd && <form onSubmit={handleCreate} style={{ display:'grid', gap:8, background:'var(--bg-surface)', padding:10, borderRadius:8, border:'1px solid var(--border)' }}>
      <input aria-label="Tên liên kết" placeholder="Tên liên kết (vd: Google Drive)..." maxLength={120} value={title} onChange={event => setTitle(event.target.value)} className="form-input" disabled={busy || !!attempt.current} required />
      <input aria-label="Địa chỉ liên kết" placeholder="Địa chỉ URL (vd: drive.google.com)..." maxLength={500} value={url} onChange={event => setUrl(event.target.value)} className="form-input" disabled={busy || !!attempt.current} required />
      {attempt.current && !saving && <p role="status">Bấm Thử lại lưu để kiểm tra yêu cầu trước, tránh tạo trùng liên kết.</p>}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:6 }}><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setShowAdd(false)}>Đóng</button><button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim() || !url.trim()}>{saving ? 'Đang lưu…' : attempt.current ? 'Thử lại lưu' : 'Lưu'}</button></div>
    </form>}
    {loading && !bookmarks.length && <p role="status">Đang tải liên kết…</p>}
    {!loading && !visibleError && !bookmarks.length && <p>Chưa có liên kết.</p>}
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))', gap:8 }}>
      {bookmarks.map(bookmark => <div className="bookmark-card" key={bookmark.id} style={{ padding:'8px 10px', background:'var(--bg-card-solid)', border:'1px solid var(--border)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
        <a href={/^https?:\/\//i.test(bookmark.url) ? bookmark.url : undefined} target="_blank" rel="noopener noreferrer" title={bookmark.url} style={{ display:'flex', alignItems:'center', gap:6, color:'var(--text-main)', textDecoration:'none', fontSize:'0.8rem', fontWeight:600, overflow:'hidden', whiteSpace:'nowrap', flex:1 }}><Globe size={14} color="var(--accent)" style={{ flexShrink:0 }} /><span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{bookmark.title}</span></a>
        {!bookmark.is_global && <button type="button" disabled={busy} onClick={() => void handleDelete(bookmark.id)} title="Xóa liên kết" aria-label={`Xóa liên kết ${bookmark.title}`} style={{ background:'none', border:0, color:'var(--text-muted)', padding:2, cursor:busy ? 'not-allowed' : 'pointer' }}><Trash2 size={12} /></button>}
      </div>)}
    </div>
  </div>;
}
