import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Construction, LoaderCircle, RefreshCw, ShieldX } from 'lucide-react';
import { ThemeToggle } from '../../components/ThemeToggle';
import { ApiError } from '../../services/api';
import brandLogo from '../../assets/logo.png';
import { appsApi } from './api';

const pendingLaunches = new Map<string, Promise<{ launch_url: string }>>();

function queryValue(name: string) {
  return new URLSearchParams(window.location.search).get(name)?.trim() || '';
}

function safeReturnTo(value: string) {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function appLabel() {
  return queryValue('name') || 'ứng dụng';
}

function StatusLayout({ tone, icon, title, description, children }: {
  tone: 'connecting' | 'denied' | 'development';
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  useEffect(() => { document.title = `${title} · Đông Tây One`; }, [title]);
  return <main className={`application-status-screen is-${tone}`}>
    <div className="application-status-theme"><ThemeToggle showLabel /></div>
    <section className="application-status-card" aria-live="polite">
      <img src={brandLogo} alt="Đông Tây One" className="application-status-logo" width={92} height={92} />
      <div className="application-status-icon" aria-hidden="true">{icon}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {children && <div className="application-status-actions">{children}</div>}
      <div className="application-status-footer">Đông Tây One · Hệ thống nội bộ Đông Tây Land</div>
    </section>
  </main>;
}

export function ApplicationConnectPage() {
  const app = queryValue('app').toLowerCase();
  const name = appLabel();
  const returnTo = safeReturnTo(queryValue('return_to') || '/');
  const [error, setError] = useState('');
  const requestKey = useMemo(() => `${app}\n${returnTo}`, [app, returnTo]);

  useEffect(() => {
    if (!app) {
      setError('Không xác định được ứng dụng cần kết nối.');
      return;
    }
    let active = true;
    let request = pendingLaunches.get(requestKey);
    if (!request) {
      request = appsApi.launchSubApp(app, 20000, returnTo);
      pendingLaunches.set(requestKey, request);
      void request.then(
        () => pendingLaunches.delete(requestKey),
        () => pendingLaunches.delete(requestKey),
      );
    }
    void request.then(result => {
      if (active) window.location.replace(result.launch_url);
    }).catch(reason => {
      if (!active) return;
      const suffix = `?app=${encodeURIComponent(app)}&name=${encodeURIComponent(name)}`;
      if (reason instanceof ApiError && reason.status === 403) {
        window.location.replace(`/access-denied${suffix}`);
      } else if (reason instanceof ApiError && (reason.status === 404 || reason.status === 503)) {
        window.location.replace(`/system-development${suffix}`);
      } else {
        setError(reason instanceof Error ? reason.message : 'Không thể kết nối ứng dụng.');
      }
    });
    return () => { active = false; };
  }, [app, name, requestKey, returnTo]);

  return <StatusLayout
    tone="connecting"
    icon={<LoaderCircle className="application-status-spinner" size={36} />}
    title="Đang kết nối ứng dụng"
    description={`Đông Tây One đang xác thực quyền truy cập và mở ${name}. Vui lòng chờ trong giây lát.`}
  >
    {error && <><div className="application-status-error" role="alert">{error}</div>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}><RefreshCw size={17} /> Thử lại</button>
      <a className="btn btn-outline" href="/homepage"><ArrowLeft size={17} /> Về trang chủ</a></>}
  </StatusLayout>;
}

export function AccessDeniedPage() {
  const name = appLabel();
  return <StatusLayout
    tone="denied"
    icon={<ShieldX size={38} />}
    title="Bạn không có quyền truy cập trang web này"
    description={`Tài khoản của bạn chưa được cấp quyền sử dụng ${name}. Vui lòng liên hệ quản trị viên để được hỗ trợ.`}
  >
    <a className="btn btn-primary" href="/homepage"><ArrowLeft size={17} /> Về trang chủ</a>
  </StatusLayout>;
}

export function SystemDevelopmentPage() {
  const name = appLabel();
  return <StatusLayout
    tone="development"
    icon={<Construction size={38} />}
    title="Hệ thống đang trong giai đoạn phát triển"
    description={`${name} đang được xây dựng và hoàn thiện. Chúng tôi sẽ thông báo khi hệ thống sẵn sàng đưa vào sử dụng.`}
  >
    <a className="btn btn-primary" href="/homepage"><ArrowLeft size={17} /> Về trang chủ</a>
  </StatusLayout>;
}
