import { useEffect, useState } from 'react';
import { History, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { accessApi, AuditPage, AuditEntry } from '../api';
const labels: Record<string, string> = {
  sharing_capability_granted: 'Cấp quyền chia sẻ lịch',
  sharing_capability_revoked: 'Thu hồi quyền chia sẻ lịch',
  calendar_shared: 'Chia sẻ lịch cho người xem',
  calendar_scope_changed: 'Đổi phạm vi xem lịch',
  calendar_revoked: 'Thu hồi quyền xem lịch',
  application_access_updated: 'Cập nhật quyền ứng dụng',
  application_account_linked: 'Liên kết tài khoản ứng dụng',
  application_account_unlinked: 'Hủy liên kết tài khoản ứng dụng',
  user_created: 'Tạo tài khoản',
  user_updated: 'Cập nhật tài khoản',
  user_password_reset: 'Đặt lại mật khẩu',
};

const applicationNames: Record<string, string> = {
  bookingreports: 'Booking 360',
  workflows: 'DT Workflow',
  itam: 'DT Assets',
};

function formatScope(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const flags = value as Record<string, boolean>;
  return [
    flags.share_events ? 'Sự kiện' : '',
    flags.share_tasks ? 'Công việc' : '',
    flags.share_notes ? 'Ghi chú' : '',
  ].filter(Boolean).join(', ');
}

interface ParsedAudit {
  category: string;
  target: string;
  statusText: string;
  statusType: 'success' | 'danger' | 'info' | 'neutral';
  role?: string;
  details?: string;
}

function parseAuditEntry(entry: AuditEntry): ParsedAudit {
  const changes = (entry.changes || {}) as Record<string, unknown>;
  const after = (changes.after || {}) as Record<string, unknown>;
  const before = (changes.before || {}) as Record<string, unknown>;

  if (entry.action === 'application_account_linked') {
    return { category: 'Ứng dụng', target: 'DT Workflow', statusText: 'Đã liên kết', statusType: 'success',
      details: `Tài khoản Workflow: @${String(after.workflow_username || '')}` };
  }
  if (entry.action === 'application_account_unlinked') {
    return { category: 'Ứng dụng', target: 'DT Workflow', statusText: 'Đã hủy liên kết', statusType: 'danger',
      details: `@${String(after.workflow_username || '')} · ${after.enabled ? 'Giữ quyền mở ứng dụng' : 'Đã thu hồi quyền mở ứng dụng'}` };
  }

  if (entry.action === 'application_access_updated') {
    const appKey = String(changes.application || '');
    const appName = applicationNames[appKey] || appKey || 'Ứng dụng';
    const isGranted = Boolean(after.enabled);
    const roleId = String(after.role_id || '');
    const roleParts = roleId ? roleId.split(':') : [];
    const roleName = roleParts.length > 0 ? roleParts[roleParts.length - 1] : '';
    const roleChanged = before.role_id !== after.role_id && Boolean(roleName);

    return {
      category: 'Ứng dụng',
      target: appName,
      statusText: isGranted ? 'Đã cấp' : 'Đã thu hồi',
      statusType: isGranted ? 'success' : 'danger',
      role: isGranted && roleName ? `Role: ${roleName}` : (roleChanged ? `Đổi role: ${roleName}` : undefined),
    };
  }

  if (entry.action === 'sharing_capability_granted') {
    return {
      category: 'Lịch',
      target: 'Quyền chia sẻ lịch',
      statusText: 'Đã cấp',
      statusType: 'success',
    };
  }

  if (entry.action === 'sharing_capability_revoked') {
    return {
      category: 'Lịch',
      target: 'Quyền chia sẻ lịch',
      statusText: 'Đã thu hồi',
      statusType: 'danger',
    };
  }

  if (entry.action === 'calendar_shared') {
    const s = formatScope(after);
    return {
      category: 'Lịch',
      target: 'Chia sẻ lịch xem',
      statusText: 'Đã chia sẻ',
      statusType: 'success',
      details: s ? `Phạm vi: ${s}` : undefined,
    };
  }

  if (entry.action === 'calendar_scope_changed') {
    const s = formatScope(after);
    return {
      category: 'Lịch',
      target: 'Phạm vi xem lịch',
      statusText: 'Đổi phạm vi',
      statusType: 'info',
      details: s ? `Phạm vi: ${s}` : undefined,
    };
  }

  if (entry.action === 'calendar_revoked') {
    return {
      category: 'Lịch',
      target: 'Quyền xem lịch',
      statusText: 'Đã thu hồi',
      statusType: 'danger',
    };
  }

  if (entry.action === 'user_created') {
    return {
      category: 'Tài khoản',
      target: 'Tài khoản hệ thống',
      statusText: 'Đã tạo mới',
      statusType: 'success',
    };
  }

  if (entry.action === 'user_password_reset') {
    return {
      category: 'Bảo mật',
      target: 'Mật khẩu tài khoản',
      statusText: 'Đã đặt lại',
      statusType: 'info',
    };
  }

  if (entry.action === 'user_updated') {
    const isLocked = after.is_active === false;
    return {
      category: 'Tài khoản',
      target: 'Thông tin tài khoản',
      statusText: isLocked ? 'Đã khóa' : 'Cập nhật',
      statusType: isLocked ? 'danger' : 'info',
      details: after.platform_admin ? 'Quản trị Platform' : undefined,
    };
  }

  return {
    category: 'Hệ thống',
    target: labels[entry.action] ?? 'Thay đổi quyền',
    statusText: 'Ghi nhận',
    statusType: 'neutral',
  };
}

function formatAuditTime(isoString: string) {
  try {
    const date = new Date(isoString);
    const timeStr = new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
      hourCycle: 'h23',
    }).format(date);
    const dateStr = new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(date);
    return `${timeStr} · ${dateStr}`;
  } catch {
    return isoString;
  }
}

export function AccessHistory({ id, targetId, revision }: { id?: string; targetId?: string; revision: number }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<AuditPage>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setCursors([undefined]);
    setIndex(0);
    setData(undefined);
  }, [targetId]);

  const cursor = cursors[index];

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError('');
    accessApi.history(targetId, cursor, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [targetId, revision, cursor, retry]);

  const items = data?.items || [];

  return (
    <section id={id} className="admin-card access-history" aria-busy={pending}>
      <div className="access-history-header">
        <div className="access-history-title-group">
          <h2>
            <History size={16} /> Lịch sử thay đổi{targetId ? ' của tài khoản' : ''}
          </h2>
          <span className="access-history-subtitle">
            Nhật ký phân quyền ứng dụng và thiết lập bảo mật
          </span>
        </div>
        {items.length > 0 && (
          <span className="access-history-counter">
            {items.length} bản ghi trên trang
          </span>
        )}
      </div>

      {pending && !data && (
        <div className="access-history-loading" role="status">
          <Clock size={15} className="spin-slow" />
          <span>Đang cập nhật lịch sử…</span>
        </div>
      )}

      {error && (
        <div className="access-history-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setRetry(value => value + 1)}>
            Thử lại
          </button>
        </div>
      )}

      {!pending && !error && items.length === 0 && (
        <div className="access-history-empty">
          <History size={26} />
          <p>Chưa có thay đổi nào được ghi nhận cho tài khoản này.</p>
        </div>
      )}

      {!error && items.length > 0 && (
        <ol className="access-history-list">
          {items.map(entry => {
            const info = parseAuditEntry(entry);
            const timeFormatted = formatAuditTime(entry.created_at);
            const isSelf = entry.actor_username === entry.subject_username;

            return (
              <li key={entry.id} className={`access-history-item is-${info.statusType}`}>
                <div className="access-history-col-status">
                  <span className={`access-history-dot is-${info.statusType}`} aria-hidden="true" />
                </div>

                <div className="access-history-col-main">
                  <div className="access-history-row-primary">
                    <span className="access-history-category-tag">{info.category}</span>
                    <strong className="access-history-target-name">{info.target}</strong>
                    <span className={`access-history-status-badge is-${info.statusType}`}>
                      {info.statusText}
                    </span>
                    {info.role && (
                      <span className="access-history-role-badge">{info.role}</span>
                    )}
                    {info.details && (
                      <span className="access-history-detail-badge">{info.details}</span>
                    )}
                  </div>

                  <div className="access-history-row-secondary">
                    <span className="access-history-actor-text">
                      {isSelf ? (
                        <>
                          Bởi <strong>{entry.actor_name}</strong> <span className="access-history-username">(@{entry.actor_username})</span>
                        </>
                      ) : (
                        <>
                          <strong>{entry.actor_name}</strong> <span className="access-history-username">(@{entry.actor_username})</span>
                          <span className="access-history-arrow">→</span>
                          <strong>{entry.subject_name}</strong> <span className="access-history-username">(@{entry.subject_username})</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <div className="access-history-col-time">
                  <Clock size={12} className="access-history-time-icon" />
                  <time dateTime={entry.created_at}>{timeFormatted}</time>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {(index > 0 || data?.next_cursor) && (
        <div className="access-pagination">
          <button
            type="button"
            className="btn btn-outline btn-sm access-page-btn"
            disabled={pending || index === 0}
            onClick={() => setIndex(value => value - 1)}
          >
            <ChevronLeft size={14} /> Mới hơn
          </button>
          <span className="access-page-indicator">Trang {index + 1}</span>
          <button
            type="button"
            className="btn btn-outline btn-sm access-page-btn"
            disabled={pending || !data?.next_cursor}
            onClick={() => {
              setCursors(values => [...values.slice(0, index + 1), data!.next_cursor!]);
              setIndex(value => value + 1);
            }}
          >
            Cũ hơn <ChevronRight size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
