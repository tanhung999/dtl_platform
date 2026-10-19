import { AuthSession, User } from '../../types';
import { request, saveSession, clearSession, getStoredUser } from '../../services/api';
export const authApi = {
  async login(username: string, password: string): Promise<AuthSession> {
    const session = await request<AuthSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    saveSession(session);
    return session;
  },

  async getMe(): Promise<User> {
    const user = await request<User>('/api/auth/me');
    const existing = getStoredUser();
    if (existing) {
      localStorage.setItem('dtl_platform_user', JSON.stringify({ ...existing, ...user }));
    }
    return user;
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      clearSession();
    }
  },
};
