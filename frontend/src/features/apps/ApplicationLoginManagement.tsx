import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { appsApi, type EnterpriseApp } from './api';

export function ApplicationLoginManagement() {
  const [applications, setApplications] = useState<EnterpriseApp[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => { appsApi.listAdmin().then(setApplications).catch(reason => setError((reason as Error).message)); }, []);

  const toggle = async (application: EnterpriseApp) => {
    setBusy(application.key); setError(''); setSuccess('');
    try {
      const updated = await appsApi.setLegacyLogin(application.key, !application.legacy_login_enabled);
      setApplications(current => current.map(item => item.key === updated.key ? updated : item));
      setSuccess(`${updated.display_name}: đăng nhập URL cũ ${updated.legacy_login_enabled ? 'đã bật' : 'đã tắt'}.`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(undefined); }
  };

  return <section className="admin-card">
    <p className="access-permission-note">SSO từ Đông Tây One luôn hoạt động. Công tắc dưới đây chỉ quyết định URL cũ có hiện form đăng nhập bằng dữ liệu riêng của website hay không. Thay đổi có hiệu lực trên website trong tối đa 60 giây.</p>
    <div className="access-permission-group">
      {applications.filter(item => item.launch_url).map(application => <div className="access-permission-row" key={application.key}>
        <div><h4>{application.display_name}</h4><p><ExternalLink size={13}/> {application.launch_url}</p></div>
        <button type="button" role="switch" aria-checked={application.legacy_login_enabled} className={`btn btn-sm ${application.legacy_login_enabled ? 'btn-primary' : 'btn-outline'}`} disabled={!!busy} onClick={() => void toggle(application)}>
          {busy === application.key ? 'Đang lưu…' : application.legacy_login_enabled ? 'URL cũ: Đang bật' : 'URL cũ: Đang tắt'}
        </button>
      </div>)}
    </div>
    {success && <p className="access-success" role="status"><CheckCircle2 size={17}/>{success}</p>}
    {error && <p className="alert-error" role="alert">{error}</p>}
  </section>;
}
