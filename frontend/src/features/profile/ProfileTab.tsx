import { profileApi } from './api';
import { sameFields } from '../../services/unchanged';
import { featureIcons } from '../../assets/featureIcons';
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
}

export const ProfileTab: React.FC<ProfileTabProps> = ({ user, onUserUpdated }) => {
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
    } catch (err: any) {
      setProfileMessage({ type: 'error', text: err.message || 'Lỗi khi cập nhật hồ sơ' });
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
    } catch (err: any) {
      setPasswordMessage({ type: 'error', text: err.message || 'Lỗi khi đổi mật khẩu' });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 1. Header Hero Card */}
      <div className="glass-panel" style={{ padding: '1.75rem', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.25rem',
              fontWeight: 800,
              boxShadow: '0 8px 16px rgba(37, 99, 235, 0.25)',
              border: '3px solid white',
            }}
          >
            {user.full_name ? user.full_name.charAt(0).toUpperCase() : <UserIcon size={36} />}
          </div>

          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                {user.full_name}
              </h2>
              <span
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
                {user.role}
              </span>
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

            <div style={{ display: 'flex', gap: '16px', marginTop: '10px', flexWrap: 'wrap', fontSize: '0.825rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Mail size={14} color="var(--accent)" /> {user.email}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Phone size={14} color="var(--accent)" /> {user.phone || 'Chưa cập nhật'}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <MapPin size={14} color="var(--accent)" /> {user.office_location || 'Trụ sở chính'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Hai cột: Form Thông tin cá nhân & Quyền truy cập SSO / Đổi mật khẩu */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem' }}>
        {/* Cột trái: Chỉnh sửa thông tin hồ sơ */}
        <div className="glass-panel" style={{ gridColumn: 'span 7', padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
            <Briefcase size={20} color="var(--accent-text)" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Thông Tin Cá Nhân & Công Tác
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Họ và tên</label>
                <input
                  type="text"
                  className="form-input"
                  maxLength={120}
                value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Tên đăng nhập (Username)</label>
                <input
                  type="text"
                  className="form-input"
                  value={user.username}
                  disabled
                  style={{ background: 'var(--input-disabled-bg)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Email doanh nghiệp</label>
                <input
                  type="email"
                  className="form-input"
                  value={user.email}
                  disabled
                  style={{ background: 'var(--input-disabled-bg)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                />
              </div>

              <div className="form-group">
                <label>Số điện thoại liên hệ</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Nhập số điện thoại..."
                  maxLength={30}
                value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Chức danh / Vị trí</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Chức danh hiện tại..."
                  maxLength={100}
                value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Phòng ban / Khối</label>
                <input
                  type="text"
                  className="form-input"
                  value={user.department}
                  disabled
                  style={{ background: 'var(--input-disabled-bg)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Chi nhánh / Địa điểm làm việc</label>
              <input
                type="text"
                className="form-input"
                placeholder="Địa chỉ trụ sở hoặc văn phòng làm việc..."
                maxLength={150}
                value={officeLocation}
                onChange={(e) => setOfficeLocation(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Ghi chú / Giới thiệu bản thân</label>
              <textarea
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
        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Card Quyền truy cập SSO */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
              <Sparkles size={18} color="var(--accent-text)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                Hệ Thống Phân Quyền (SSO)
              </h3>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.4 }}>
              Tài khoản của bạn được cấp quyền đăng nhập tự động vào các phân hệ nghiệp vụ sau:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <img src={featureIcons.income} alt="Income Statement" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>Income Statement</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Báo cáo thu nhập & doanh số</div>
                  </div>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--success-text)', background: 'var(--success-bg)', fontWeight: 700, padding: '2px 8px', borderRadius: '12px' }}>
                  Đã cấp phép
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <img src={featureIcons.workflow} alt="Workflows" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>Workflows</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Luồng trình ký & hồ sơ nội bộ</div>
                  </div>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--success-text)', background: 'var(--success-bg)', fontWeight: 700, padding: '2px 8px', borderRadius: '12px' }}>
                  Đã cấp phép
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <img src={featureIcons.assets} alt="Asset Manager" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>Asset Manager</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Quản lý tài sản & cấp phát IT</div>
                  </div>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--success-text)', background: 'var(--success-bg)', fontWeight: 700, padding: '2px 8px', borderRadius: '12px' }}>
                  Đã cấp phép
                </span>
              </div>
            </div>
          </div>

          {/* Card Đổi mật khẩu */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
              <KeyRound size={18} color="var(--accent-text)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                Đổi Mật Khẩu
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
                <label style={{ fontSize: '0.775rem' }}>Mật khẩu hiện tại</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Nhập mật khẩu đang dùng..."
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.775rem' }}>Mật khẩu mới</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Tối thiểu 6 ký tự..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.775rem' }}>Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Nhập lại mật khẩu mới..."
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
