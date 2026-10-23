import { Component, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export function PageLoading({ startup = false }: { startup?: boolean }) {
  return <div className={`page-loading${startup ? ' is-startup' : ''}`} role="status"><Loader2 className="page-loading-spinner" size={22} aria-hidden="true" /><span>Đang mở trang…</span></div>;
}

export class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="page-loading" role="alert"><p>Không thể mở trang. Hãy kiểm tra kết nối và thử lại.</p><button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Thử tải lại</button></div>;
    return this.props.children;
  }
}
