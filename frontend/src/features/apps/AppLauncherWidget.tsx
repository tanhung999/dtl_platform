import { useListMotion } from '../drag-feedback/useListMotion';
import React, { useState } from 'react';
import { ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import { SubAppInfo } from '../../types';
import { orderedItems, useWorkspaceLayout } from '../workspace-layout/WorkspaceLayoutProvider';
import { SortableWidgetCard, SortableWidgetGroup } from '../workspace-layout/SortableWidgets';

const APPS: SubAppInfo[] = [
  {
    id: 'bookingreports',
    name: 'Income Statement',
    shortName: 'Báo cáo Thu nhập & Bán hàng',
    description: 'Báo cáo thu nhập, doanh số bán hàng, bảng tính hoa hồng và theo dõi giỏ hàng bất động sản.',
    category: 'Tài Chính & Kinh Doanh',
    // badge: 'FastAPI + React',
    themeColor: '#eff6ff',
    iconUrl: '/icon-booking.png',
  },
  {
    id: 'workflows',
    name: 'Workflows',
    shortName: 'Hệ thống Trình ký',
    description: 'Theo dõi luồng xử lý hồ sơ, phê duyệt chứng từ, phân công công việc và quản lý SLA.',
    category: 'Vận Hành',
    // badge: 'FastAPI + AntD',
    themeColor: '#f5f3ff',
    iconUrl: '/icon-workflow.png',
  },
  {
    id: 'itam',
    name: 'Asset Manager',
    shortName: 'Quản lý Tài sản',
    description: 'Quản lý cấp phát thiết bị IT, tài sản hành chính, kiểm kê kho và thủ tục nhân sự onboarding.',
    category: 'Hành Chính & IT',
    // badge: 'Flask + Vue 3',
    themeColor: '#ecfdf5',
    iconUrl: '/icon-assets.png',
  },
];

export const AppLauncherWidget: React.FC = () => {
  const layout = useWorkspaceLayout();
  const apps = orderedItems(APPS, layout.layout.apps.ids);
  const disabled = layout.busy || layout.loading;
  const [launchingApp, setLaunchingApp] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const list = useListMotion(apps.map(item => item.id), 'data-sort-id');
  const handleLaunch = async (app: SubAppInfo) => {
    setLaunchingApp(app.id);
    setErrorMessage(null);
    try {
      const result = await api.launchSubApp(app.id);
      if (result.launch_url) {
        window.open(result.launch_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      setErrorMessage(`Không thể kết nối tới ${app.name}: ${err.message || 'Lỗi server'}`);
    } finally {
      setLaunchingApp(null);
    }
  };

  return (
    <div className="glass-panel widget-box">
      <div className="widget-header">
        <div className="widget-title">
          <Sparkles size={18} className="widget-title-icon" />
          <span>Ứng Dụng Doanh Nghiệp (Enterprise Apps)</span>
        </div>
      </div>

      {errorMessage && (
        <div className="alert-error" style={{ marginBottom: '0.5rem' }}>
          {errorMessage}
        </div>
      )}

      <SortableWidgetGroup revision={layout.layout.apps.version} ids={apps.map(app => app.id)} disabled={disabled} onSort={ids => layout.save('apps', ids)}><div data-sort-group="apps" ref={list} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {apps.map((app) => {
          const isLaunching = launchingApp === app.id;
          return (
            <SortableWidgetCard id={app.id} label={app.name} disabled={disabled}
              key={app.id}
              className="app-card"
              onClick={() => handleLaunch(app)}
            >
              <div className="app-card-top">
                <div
                  className="app-card-icon-wrap"
                  style={{ backgroundColor: app.themeColor }}
                >
                  <img
                    src={app.iconUrl}
                    alt={app.name}
                    style={{ width: '30px', height: '30px', objectFit: 'contain' }}
                  />
                </div>
                <span className="app-card-badge">{app.badge}</span>
              </div>

              <div>
                <h4 className="app-card-title">{app.name}</h4>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  {app.shortName}
                </div>
                <p className="app-card-desc">{app.description}</p>
              </div>

              <div className="app-card-footer">
                <span>Vào ứng dụng</span>
                {isLaunching ? (
                  <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <ExternalLink size={15} />
                )}
              </div>
            </SortableWidgetCard>
          );
        })}
      </div></SortableWidgetGroup>
    </div>
  );
};
