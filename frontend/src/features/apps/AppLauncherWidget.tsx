import { appsApi } from './api';
import { featureIcons } from '../../assets/featureIcons';
import { useRef, useState } from 'react';
import { ArrowUpRight, ExternalLink, LayoutGrid, Loader2 } from 'lucide-react';

import { SubAppInfo } from '../../types';

const APPS: SubAppInfo[] = [
  {
    id: 'bookingreports',
    name: 'Income Statement',
    shortName: 'Báo cáo Thu nhập & Bán hàng',
    description: 'Báo cáo thu nhập, doanh số bán hàng, bảng tính hoa hồng và theo dõi giỏ hàng bất động sản.',
    category: 'Tài Chính & Kinh Doanh',
    iconUrl: featureIcons.income,
  },
  {
    id: 'workflows',
    name: 'Workflows',
    shortName: 'Hệ thống trình ký',
    description: 'Theo dõi luồng xử lý hồ sơ, phê duyệt chứng từ.',
    category: 'Vận Hành',
    iconUrl: featureIcons.workflow,
  },
  {
    id: 'itam',
    name: 'Asset Manager',
    shortName: 'Quản lý Tài sản',
    description: 'Quản lý cấp phát thiết bị IT, tài sản hành chính, kiểm kê kho và thủ tục tiếp nhận nhân sự.',
    category: 'Hành Chính & IT',
    iconUrl: featureIcons.assets,
  },
];

export function AppLauncherWidget({ allowedApps, resultIds, detailed = false, onOpenAll }: {
  allowedApps: string; resultIds?: string[]; detailed?: boolean; onOpenAll?: () => void;
}) {
  const [launchingApp, setLaunchingApp] = useState<string | null>(null);
  const launching = useRef(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [readyLink, setReadyLink] = useState<{ url: string; name: string }>();
  const permissions = new Set(allowedApps.split(',').map(value => value.trim()));
  const available = APPS.filter(app => permissions.has(app.id));
  const filtered = resultIds ? available.filter(app => resultIds.includes(app.id)) : available;
  const handleLaunch = async (app: SubAppInfo) => {
    if (launching.current) return;
    launching.current = true; setLaunchingApp(app.id); setErrorMessage(''); setReadyLink(undefined);
    // Open during the click so normal popup protection does not block the SSO tab.
    let tab: Window | null = null;
    try {
      tab = window.open('about:blank', '_blank');
      if (tab) { tab.opener = null; tab.document.title = app.name; tab.document.body.textContent = 'Đang kết nối ứng dụng…'; }
      const result = await appsApi.launchSubApp(app.id, 15000);
      if (tab && !tab.closed) tab.location.replace(result.launch_url);
      else setReadyLink({ url: result.launch_url, name: app.name });
    } catch (reason) {
      tab?.close(); setErrorMessage(`Không thể mở ${app.name}: ${reason instanceof Error ? reason.message : 'Vui lòng thử lại.'}`);
    } finally { launching.current = false; setLaunchingApp(null); }
  };
  return <section className={`glass-panel widget-box enterprise-apps${detailed ? ' is-detailed' : ''}`} aria-label="Ứng dụng doanh nghiệp">
    <div className="widget-header"><div className="widget-title"><LayoutGrid size={19} className="widget-title-icon" /><span>Ứng dụng doanh nghiệp</span></div>
      {onOpenAll && <button type="button" className="workspace-text-link" onClick={onOpenAll}>Xem tất cả <ArrowUpRight size={16} /></button>}
    </div>
    {errorMessage && <p className="alert-error" role="alert">{errorMessage}</p>}
    {readyLink && <p role="status">Trình duyệt chưa mở tab mới. <a className="workspace-text-link" href={readyLink.url} target="_blank" rel="noopener noreferrer">Mở {readyLink.name} <ExternalLink size={14} /></a></p>}
    {!filtered.length && <p className="workspace-empty">{!available.length ? 'Bạn chưa được cấp quyền truy cập ứng dụng doanh nghiệp.' : 'Không tìm thấy ứng dụng phù hợp.'}</p>}
    <div className="enterprise-app-grid">{filtered.map(app => <button type="button" key={app.id} className="enterprise-app-card" aria-label={`Mở ${app.name}`} disabled={launchingApp !== null} onClick={() => { void handleLaunch(app); }}>
      <img src={app.iconUrl} alt="" width={66} height={66} />
      <strong>{app.name}</strong><span className="enterprise-app-subtitle">{app.shortName}</span>
      {detailed && <span className="enterprise-app-description">{app.description}</span>}
      {launchingApp === app.id ? <Loader2 size={16} className="enterprise-app-progress" aria-label="Đang kết nối" /> : <ArrowUpRight size={15} className="enterprise-app-arrow" aria-hidden="true" />}
    </button>)}</div>
  </section>;
}
