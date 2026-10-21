import { authApi } from './api';
import React, { useState } from 'react';
import { User, Eye, EyeOff, ArrowRight, ShieldCheck } from 'lucide-react';

import { AuthSession } from '../../types';
import { ThemeToggle } from '../../components/ThemeToggle';

interface LoginPageProps {
  onLoginSuccess: (session: AuthSession) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const session = await authApi.login(username.trim(), password);
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
          <img src="/logo.png" alt="Đông Tây Land" className="login-brand-logo" />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.5rem' }}>
            ĐÔNG TÂY LAND PLATFORM
          </h2>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
            Đăng nhập một lần để truy cập toàn bộ hệ thống
          </p>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Tên đăng nhập hoặc Email</label>
            <div style={{ position: 'relative' }}>
              <input
                id="username"
                type="text"
                className="form-input"
                placeholder="Nhập username hoặc email..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
              />
              <User
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
            Designed by <strong>Phòng CN & CĐS - Đông Tây Land</strong> &bull; v 1.0.0
          </div>
        </div>
      </div>
    </div>
  );
};
