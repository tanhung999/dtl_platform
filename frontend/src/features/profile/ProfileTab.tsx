import './profile.css';
import { profileApi } from './api';
import { sameFields } from '../../services/unchanged';
import { FeatureIcon } from '../../components/FeatureIcon';
import React, { useState } from 'react';
import {
  User as UserIcon,
  Mail,
  Phone,
  Briefcase,
  MapPin,
  KeyRound,
  CheckCircle2,
  Save,
  AlertCircle,
  Sparkles,
  Lock,
} from 'lucide-react';

import { User } from '../../types';

interface ProfileTabProps {
  user: User;
  onUserUpdated: (user: User) => void;
  canManage?: boolean;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({ user, onUserUpdated, canManage = false }) => {
  const allowedApps = new Set((user.allowed_apps ?? '').split(',').map(value => value.trim()));
  // Profile edit form state
  const [fullName, setFullName] = useState(user.full_name || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [jobTitle, setJobTitle] = useState(user.job_title || '');
  const [officeLocation, setOfficeLocation] = useState(user.office_location || '');
  const [bio, setBio] = useState(user.bio || '');

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password change form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingProfile) return;
    const payload = { full_name: fullName.trim(), phone: phone.trim(), job_title: jobTitle.trim(), office_location: officeLocation.trim(), bio: bio.trim() };
    if (sameFields(payload, { ...user })) { setProfileMessage({ type: 'success', text: 'Thông tin chưa thay đổi.' }); return; }
    setSavingProfile(true);
    setProfileMessage(null);
    try {
      const updated = await profileApi.updateProfile(payload);
      onUserUpdated(updated);
      setProfileMessage({ type: 'success', text: 'Cập nhật thông tin tài khoản thành công!' });
    } catch (err) {
      setProfileMessage({ type: 'error', text: err instanceof Error ? err.message : 'Không thể cập nhật hồ sơ.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPassword) return;
    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'Mật khẩu mới phải có tối thiểu 6 ký tự.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Xác nhận mật khẩu mới không khớp.' });
      return;
    }

    setSavingPassword(true);
    setPasswordMessage(null);
    try {
      await profileApi.changePassword(currentPassword, newPassword);
      setPasswordMessage({ type: 'success', text: 'Đã đổi mật khẩu thành công!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordMessage({ type: 'error', text: err instanceof Error ? err.message : 'Không thể đổi mật khẩu.' });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="profile-page">
      {/* 1. Header Hero Card */}
      <div className="glass-panel" style={{ padding: '1.75rem', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              background: 'var(--accent-gradient)',
              color: 'var(--on-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.25rem',
              fontWeight: 800,
              boxShadow: '0 8px 16px color-mix(in srgb, var(--accent) 25%, transparent)',
              border: '3px solid white',
            }}
          >
            {user.full_name ? user.full_name.charAt(0).toUpperCase() : <UserIcon size={36} />}
          </div>

          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                {user.full_name}
              </h2>
              {canManage && <span
                style={{
                  background: 'var(--primary-light)',
                  color: 'var(--accent-text)',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  borderRadius: '20px',
                  border: '1px solid var(--border)',
                }}
              >
                Quản trị hệ thống
              </span>}
              {user.employee_code && (
                <span
                  style={{
                    background: 'var(--bg-subtle)',
                    color: 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    padding: '3px 8px',
                    borderRadius: '20px',
                    border: '1px solid var(--border)',
                  }}
                >
                  Mã NV: {user.employee_code}
                </span>
              )}
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '4px' }}>
              {user.job_title || 'Thành viên'} &bull; <span style={{ color: 'var(--accent-text)' }}>{user.department}</span>
            </p>

            <div className="profile-contacts">
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Mail size={14} color="var(--accent-text)" aria-hidden="true" /><span>{user.email}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Phone size={14} color="var(--accent-text)" aria-hidden="true" /><span>{user.phone || 'Chưa cập nhật'}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <MapPin size={14} color="var(--accent-text)" aria-hidden="true" /><span>{user.office_location || 'Trụ sở chính'}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Hai cột: Form Thông tin cá nhân & Quyền truy cập SSO / Đổi mật khẩu */}
      <div className="profile-layout">
        {/* Cột trái: Chỉnh sửa thông tin hồ sơ */}
        <div className="glass-panel profile-edit-card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
            <Briefcase size={20} color="var(--accent-text)" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Thông tin cá nhân và công tác
            </h3>
          </div>

          {profileMessage && (
            <div
              className={profileMessage.type === 'success' ? 'glass-panel' : 'alert-error'}
              style={{
                marginBottom: '1rem',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: profileMessage.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)',
                color: profileMessage.type === 'success' ? 'var(--success-text)' : 'var(--error)',
                border: '1px solid var(--border)',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {profileMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{profileMessage.text}</span>
            </div>
          )}

          <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="profile-fields">
              <div className="form-group">
                <label htmlFor="profile-field-1">Họ và tên</label>
                <input id="profile-field-1" disabled={savingProfile}
                  type="text"
                  className="form-input"
                  maxLength={120}
                value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-field-2">Tên đăng nhập</label>
                <input id="profile-field-2"
                  type="text"
                  className="form-input"
                  value={user.username}
                  disabled
                  style={{ background: 'var(--input-disabled-bg)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                />
              </div>
            </div>

            <div className="profile-fields">
              <div className="form-group">
                <label htmlFor="profile-field-3">Email doanh nghiệp</label>
                <input id="profile-field-3"
                  type="email"
                  className="form-input"
                  value={user.email}
                  disabled
                  style={{ background: 'var(--input-disabled-bg)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-field-4">Số điện thoại liên hệ</label>
                <input id="profile-field-4" disabled={savingProfile}
                  type="text"
                  className="form-input"
                  placeholder="Nhập số điện thoại..."
                  maxLength={30}
                value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="profile-fields">
              <div className="form-group">
                <label htmlFor="profile-field-5">Chức danh / Vị trí</label>
                <input id="profile-field-5" disabled={savingProfile}
                  type="text"
                  className="form-input"
                  placeholder="Chức danh hiện tại..."
                  maxLength={100}
                value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-field-6">Phòng ban / Khối</label>
                <input id="profile-field-6"
                  type="text"
                  className="form-input"
                  value={user.department}
                  disabled
                  style={{ background: 'var(--input-disabled-bg)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="profile-field-7">Chi nhánh / Địa điểm làm việc</label>
              <input id="profile-field-7" disabled={savingProfile}
                type="text"
                className="form-input"
                placeholder="Địa chỉ trụ sở hoặc văn phòng làm việc..."
                maxLength={150}
                value={officeLocation}
                onChange={(e) => setOfficeLocation(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="profile-field-8">Ghi chú / Giới thiệu bản thân</label>
              <textarea id="profile-field-8" disabled={savingProfile}
                className="form-input"
                rows={3}
                placeholder="Mô tả ngắn gọn về chuyên môn, nhiệm vụ..."
                maxLength={10000}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={savingProfile}>
                <Save size={16} />
                <span>{savingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Cột phải: Quyền truy cập SSO & Đổi mật khẩu */}
        <div className="profile-secondary">
          {/* Card Quyền truy cập SSO */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
              <Sparkles size={18} color="var(--accent-text)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                Quyền truy cập ứng dụng
              </h3>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.4 }}>
              Quyền truy cập các ứng dụng của tài khoản:
            </p>

            <div className="profile-app-permissions">
              {[
                { id: 'bookingreports', name: 'DT Income Statement', description: 'Báo cáo thu nhập và doanh số', icon: 'income' as const },
                { id: 'workflows', name: 'DT Workflow', description: 'Luồng phê duyệt và trình ký', icon: 'workflow' as const },
                { id: 'itam', name: 'DT Assets', description: 'Quản lý tài sản và cấp phát IT', icon: 'assets' as const },
              ].map(app => <div className="profile-app-permission" key={app.id} data-app-id={app.id}>
                <FeatureIcon name={app.icon} size={24} />
                <div><strong>{app.name}</strong><small>{app.description}</small></div>
                <span className={allowedApps.has(app.id) ? 'is-granted' : 'is-unavailable'}>{allowedApps.has(app.id) ? 'Đã cấp quyền' : 'Chưa cấp quyền'}</span>
              </div>)}
            </div>
          </div>

          {/* Card Đổi mật khẩu */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
              <KeyRound size={18} color="var(--accent-text)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                Đổi mật khẩu
              </h3>
            </div>

            {passwordMessage && (
              <div
                className={passwordMessage.type === 'success' ? 'glass-panel' : 'alert-error'}
                style={{
                  marginBottom: '1rem',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  background: passwordMessage.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)',
                  color: passwordMessage.type === 'success' ? 'var(--success-text)' : 'var(--error)',
                  border: '1px solid var(--border)',
                  fontSize: '0.825rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {passwordMessage.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <span>{passwordMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div className="form-group">
                <label htmlFor="profile-field-9" style={{ fontSize: '0.775rem' }}>Mật khẩu hiện tại</label>
                <input id="profile-field-9" disabled={savingPassword}
                  type="password"
                  className="form-input"
                  autoComplete="current-password" placeholder="Nhập mật khẩu đang dùng..."
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-field-10" style={{ fontSize: '0.775rem' }}>Mật khẩu mới</label>
                <input id="profile-field-10" disabled={savingPassword}
                  type="password"
                  className="form-input"
                  autoComplete="new-password" minLength={6} placeholder="Tối thiểu 6 ký tự..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-field-11" style={{ fontSize: '0.775rem' }}>Xác nhận mật khẩu mới</label>
                <input id="profile-field-11" disabled={savingPassword}
                  type="password"
                  className="form-input"
                  autoComplete="new-password" placeholder="Nhập lại mật khẩu mới..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: '0.5rem', width: '100%', padding: '0.6rem' }}
                disabled={savingPassword}
              >
                <Lock size={14} />
                <span>{savingPassword ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
