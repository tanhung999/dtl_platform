import { appsApi, EnterpriseApp } from './api';
import { FeatureIcon } from '../../components/FeatureIcon';
import { FeatureIconName, brandIconCells } from '../../assets/featureIcons';
import { useEffect, useState } from 'react';
import { ArrowUpRight, ExternalLink, LayoutGrid } from 'lucide-react';

const iconName = (value: string): FeatureIconName => value === 'tasks' || value in brandIconCells ? value as FeatureIconName : 'platform';

export function AppLauncherWidget({ resultIds, detailed = false, onOpenAll }: {
  resultIds?: string[]; detailed?: boolean; onOpenAll?: () => void;
}) {
  const [apps, setApps] = useState<EnterpriseApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [readyLink, setReadyLink] = useState<{ url: string; name: string }>();
  useEffect(() => {
    let active = true;
    appsApi.listMine()
      .then(result => { if (active) setApps(result); })
      .catch(reason => { if (active) setErrorMessage(reason instanceof Error ? reason.message : 'Không thể tải danh sách ứng dụng.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const filtered = resultIds ? apps.filter(app => resultIds.includes(app.key)) : apps;
  const handleLaunch = (app: EnterpriseApp) => {
    setErrorMessage(''); setReadyLink(undefined);
    const params = new URLSearchParams({ app: app.key, name: app.display_name, return_to: '/' });
    const url = `/applications/connect?${params.toString()}`;
    const tab = window.open(url, '_blank');
    if (tab) tab.opener = null;
    else setReadyLink({ url, name: app.display_name });
  };
  return <section className={`glass-panel widget-box enterprise-apps${detailed ? ' is-detailed' : ''}`} aria-label="Ứng dụng doanh nghiệp">
    <div className="widget-header"><div className="widget-title"><LayoutGrid size={19} className="widget-title-icon" /><span>Ứng dụng doanh nghiệp</span></div>
      {onOpenAll && <button type="button" className="workspace-text-link" onClick={onOpenAll}>Xem tất cả <ArrowUpRight size={16} /></button>}
    </div>
    {errorMessage && <p className="alert-error" role="alert">{errorMessage}</p>}
    {readyLink && <p role="status">Trình duyệt chưa mở tab mới. <a className="workspace-text-link" href={readyLink.url} target="_blank" rel="noopener noreferrer">Mở {readyLink.name} <ExternalLink size={14} /></a></p>}
    {loading && <p className="workspace-empty" role="status">Đang tải ứng dụng…</p>}
    {!loading && !filtered.length && <p className="workspace-empty">{!apps.length ? 'Bạn chưa được cấp quyền truy cập ứng dụng doanh nghiệp.' : 'Không tìm thấy ứng dụng phù hợp.'}</p>}
    <div className="enterprise-app-grid">{filtered.map(app => <button type="button" key={app.key} className="enterprise-app-card" aria-label={`Mở ${app.display_name}`} onClick={() => handleLaunch(app)}>
      {app.icon_url ? <img className="feature-icon" src={app.icon_url} alt="" aria-hidden="true" width={66} height={66} /> : <FeatureIcon name={iconName(app.icon_key)} size={66} />}
      <strong>{app.display_name}</strong>
      <ArrowUpRight size={15} className="enterprise-app-arrow" aria-hidden="true" />
    </button>)}</div>
  </section>;
}
