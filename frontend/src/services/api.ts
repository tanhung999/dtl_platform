import { AuthSession, Note, Task, Bookmark, User } from '../types';

const TOKEN_KEY = 'dtl_platform_token';
const USER_KEY = 'dtl_platform_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const data = localStorage.getItem(USER_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(TOKEN_KEY, session.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearSession();
    // Dispatch auth state change or reload
    window.dispatchEvent(new Event('auth:unauthorized'));
    throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }

  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.detail || `Yêu cầu thất bại (Mã lỗi HTTP ${response.status})`;
    throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
  }

  return data as T;
}

export const api = {
  // Auth
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

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      clearSession();
    }
  },

  // SSO Launch
  async launchSubApp(targetApp: 'bookingreports' | 'workflows' | 'itam'): Promise<{ launch_url: string; ticket: string }> {
    return request('/api/sso/launch', {
      method: 'POST',
      body: JSON.stringify({ target_app: targetApp }),
    });
  },

  // Notes
  async getNotes(): Promise<Note[]> {
    return request<Note[]>('/api/notes');
  },

  async createNote(payload: Partial<Note>): Promise<Note> {
    return request<Note>('/api/notes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateNote(id: string, payload: Partial<Note>): Promise<Note> {
    return request<Note>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteNote(id: string): Promise<void> {
    return request(`/api/notes/${id}`, { method: 'DELETE' });
  },

  // Tasks
  async getTasks(): Promise<Task[]> {
    return request<Task[]>('/api/tasks');
  },

  async createTask(payload: { title: string; priority?: string; due_date?: string }): Promise<Task> {
    return request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateTask(id: string, payload: Partial<Task>): Promise<Task> {
    return request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteTask(id: string): Promise<void> {
    return request(`/api/tasks/${id}`, { method: 'DELETE' });
  },

  // Bookmarks
  async getBookmarks(): Promise<Bookmark[]> {
    return request<Bookmark[]>('/api/bookmarks');
  },

  async createBookmark(payload: { title: string; url: string; icon?: string; category?: string }): Promise<Bookmark> {
    return request<Bookmark>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteBookmark(id: string): Promise<void> {
    return request(`/api/bookmarks/${id}`, { method: 'DELETE' });
  },
};
