import { authApi } from './api';
import React, { useState } from 'react';
import { User as UserIcon, Eye, EyeOff, ArrowRight, ShieldCheck } from 'lucide-react';

import { AuthSession } from '../../types';
import { ThemeToggle } from '../../components/ThemeToggle';
import brandLogo from '../../assets/logo-source.png';
import { APP_VERSION } from '../../config';

interface LoginPageProps {
  onLoginSuccess: (session: AuthSession) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const query = new URLSearchParams(window.location.search);
  const targetApp = query.get('app')?.trim().toLowerCase() || '';
  const requestedReturnTo = query.get('return_to') || '/';
  const safeReturnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(query.get('reason') === 'password-changed' ? 'Đã đổi mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới.' : '');
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }

    setError(null);
    setNotice('');
    setLoading(true);
    try {
      const session = await authApi.login(username.trim(), password);
      if (targetApp) {
        onLoginSuccess(session);
        const params = new URLSearchParams({ app: targetApp, return_to: safeReturnTo });
        window.location.assign(`/applications/connect?${params.toString()}`);
        return;
      }
      onLoginSuccess(session);
    } catch (err: any) {
      setError(err?.message || 'Không thể đăng nhập. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div style={{ position: 'absolute', top: '1.25rem', right: '1.5rem', zIndex: 10 }}>
        <ThemeToggle showLabel />
      </div>
      <div className="login-card">
        <div className="login-brand-header">
          <img src={brandLogo} alt="Đông Tây One" className="login-brand-logo" width={96} height={96} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.5rem' }}>
            Đông Tây One
          </h2>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
            Đăng nhập một lần để truy cập toàn bộ hệ thống
          </p>
        </div>

        <div className="login-error-slot" aria-live="polite">
          {notice && <p role="status" style={{ color: 'var(--success-text)' }}>{notice}</p>}
          {error && <div className="alert-error" role="alert">{error}</div>}
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Tên đăng nhập hoặc Email</label>
            <div style={{ position: 'relative' }}>
              <input
                id="username"
                type="text"
                className="form-input"
                placeholder="Nhập tên đăng nhập hoặc email…"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
              />
              <UserIcon
                size={16}
                style={{ position: 'absolute', right: 12, top: 12, color: 'var(--text-muted)' }}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Mật khẩu</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="Nhập mật khẩu..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: 9,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
            disabled={loading}
          >
            {loading ? (
              <span>Đang xác thực...</span>
            ) : (
              <>
                <span>Đăng nhập hệ thống</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '4px' }}>
            <ShieldCheck size={14} color="var(--accent-text)" />
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Bảo mật nội bộ Đông Tây Land</span>
          </div>
          <div>Liên hệ quản trị viên nếu bạn chưa có tài khoản.</div>
          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
            Designed by <strong>Phòng CN & CĐS - Đông Tây Land</strong> &bull; v {APP_VERSION}
          </div>
        </div>
      </div>
    </div>
  );
};
