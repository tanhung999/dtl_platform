import { requestWithTimeout } from '../../services/requestTimeout';

export interface ManagedUser {
  id: string;
  identity_subject: string | null;
  username: string;
  email: string;
  full_name: string;
  department: string;
  job_title: string;
  employee_code: string;
  phone: string;
  office_location: string;
  is_active: boolean;
  platform_admin: boolean;
  created_at: string;
}

export interface ManagedUserPage { items: ManagedUser[]; total: number; page: number; has_more: boolean }
export type ManagedUserCreate = Omit<ManagedUser, 'id' | 'identity_subject' | 'is_active' | 'created_at'> & { password: string };
export type ManagedUserUpdate = Pick<ManagedUser, 'email' | 'full_name' | 'department' | 'job_title' | 'employee_code' | 'phone' | 'office_location' | 'is_active' | 'platform_admin'>;

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export const usersApi = {
  list: (q = '', page = 1, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(page) });
    if (q.trim()) params.set('q', q.trim());
    return requestWithTimeout<ManagedUserPage>('/api/admin/users?' + params, { signal, cache: 'no-store' });
  },
  create: (payload: ManagedUserCreate) => requestWithTimeout<ManagedUser>('/api/admin/users', json('POST', payload)),
  update: (id: string, payload: ManagedUserUpdate) => requestWithTimeout<ManagedUser>(`/api/admin/users/${id}`, json('PUT', payload)),
  resetPassword: (id: string, password: string) => requestWithTimeout<void>(`/api/admin/users/${id}/password`, json('PUT', { password })),
};
