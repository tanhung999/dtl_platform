import { MapPin } from 'lucide-react';
import { SharingDialog } from '../SharingDialog';
import { SharedItem } from '../api';
import { sharedKindLabel, sharedRangeLabel } from '../sharedItemUtils';

export function SharedItemDialog({ selected, item, error, pending, verifying, onClose, onRetry }: {
  selected: SharedItem; item?: SharedItem; error: string; pending: boolean; verifying: boolean; onClose: () => void; onRetry: () => void;
}) {
  const value = verifying ? undefined : item && selected.series_id && item.recurrence !== 'NONE' ? { ...item, starts_at: selected.starts_at, ends_at: selected.ends_at } : item;
  return <SharingDialog title={`${sharedKindLabel(selected)} · Chỉ xem`} onClose={onClose}>
    <div className={`sharing-dialog-body ${value?.kind === 'note' ? 'shared-note-detail' : ''}`} style={value?.kind === 'note' ? { background: value.color, color: '#172033' } : undefined}>
      {error ? <div role="alert"><p>{error}</p><button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>Thử lại</button></div>
        : !value ? <p role="status">Đang kiểm tra quyền và tải chi tiết…</p> : <><h3>{value.title || 'Ghi chú không có tiêu đề'}</h3>
          <p className="shared-detail-range">{sharedRangeLabel(value)}{value.recurrence === 'DAILY' ? ' · Lặp hằng ngày' : value.recurrence === 'WEEKLY' ? ' · Lặp hằng tuần' : ''}</p>{value.location && <p><MapPin size={14} /> {value.location}</p>}
          <div className="shared-note-content">{value.content || 'Chưa có nội dung.'}</div><div className="shared-detail-update" role="status">{pending?'Đang cập nhật…':'\u00a0'}</div></>}
    </div>
  </SharingDialog>;
}
