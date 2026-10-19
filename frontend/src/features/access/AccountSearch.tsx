import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { accessApi, Account } from './api';

export function AccountSearch({ onSelect, selfId, disabled = false }: { onSelect: (value: Account) => void; selfId?: string; disabled?: boolean }) {
  const [q, setQ] = useState(''), [rows, setRows] = useState<Account[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => { setRows([]); setError(''); if (q.trim().length < 2) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true);
    const timer = setTimeout(() => accessApi.accounts(q.trim(), controller.signal).then(value => { if (!controller.signal.aborted) setRows(value.filter(x => x.id !== selfId)); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }), 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, selfId]);
  return <div className="sharing-search"><label className="calendar-field"><span><Search size={15} /> Tìm tài khoản</span><input disabled={disabled} className="form-input" value={q} maxLength={100} onChange={e => setQ(e.target.value)} placeholder="Nhập ít nhất 2 ký tự tên hoặc tài khoản" /></label>
    {loading && <p role="status">Đang tìm…</p>}{error && <p role="alert">{error}</p>}
    {!!rows.length && <div className="sharing-account-results">{rows.map(row => <button type="button" disabled={disabled} key={row.id} onClick={() => { onSelect(row); setQ(''); }}><strong>{row.full_name}</strong><small>@{row.username}</small></button>)}</div>}
    {!loading && q.trim().length >= 2 && !rows.length && !error && <p>Không tìm thấy tài khoản.</p>}
  </div>;
}
