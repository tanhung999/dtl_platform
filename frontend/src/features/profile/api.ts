import { User } from '../../types';
import { request } from '../../services/api';
export const profileApi = {
  async updateProfile(payload: Partial<User>): Promise<User> {
    const updated = await request<User>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    localStorage.setItem('dtl_platform_user', JSON.stringify(updated));
    return updated;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  },
};
