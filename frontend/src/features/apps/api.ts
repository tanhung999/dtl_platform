import { request } from '../../services/api';
import { requestWithTimeout } from '../../services/requestTimeout';
export interface EnterpriseApp {
  key: string;
  display_name: string;
  description: string;
  category: string;
  icon_key: string;
  icon_url?: string | null;
  launch_url: string;
  permission_prefix: string;
  is_active: boolean;
  legacy_login_enabled: boolean;
  sort_order: number;
}
export interface UserApplicationAccess {
  key: string;
  display_name: string;
  description: string;
  icon_key: string;
  enabled: boolean;
  role_key?: string | null;
  role_display_name?: string | null;
  permission_keys: string[];
  project_names: string[];
  roles: Array<{ key: string; display_name: string; description: string; permission_keys: string[] }>;
  permissions: Array<{ code: string; display_name: string; group_name: string }>;
}
export interface UserApplicationAccessInput {
  enabled: boolean;
  role_key?: string | null;
  permission_keys?: string[];
  project_names?: string[];
}
export const appsApi = {
  listAdmin(): Promise<EnterpriseApp[]> {
    return request('/api/admin/applications', { cache: 'no-store' });
  },
  setLegacyLogin(applicationKey: string, enabled: boolean): Promise<EnterpriseApp> {
    return request(`/api/admin/applications/${encodeURIComponent(applicationKey)}/legacy-login`, {
      method: 'PATCH', body: JSON.stringify({ enabled }),
    });
  },
  listMine(): Promise<EnterpriseApp[]> {
    return request('/api/applications/me');
  },
  listUserAccess(userId: string): Promise<UserApplicationAccess[]> {
    return request(`/api/admin/applications/users/${encodeURIComponent(userId)}/access`, { cache: 'no-store' });
  },
  setUserAccess(applicationKey: string, userId: string, payload: UserApplicationAccessInput): Promise<UserApplicationAccess> {
    return request(`/api/admin/applications/${encodeURIComponent(applicationKey)}/users/${encodeURIComponent(userId)}`, {
      method: 'PUT', body: JSON.stringify(payload),
    });
  },
  launchSubApp(targetApp: string, timeoutMs?: number, returnTo = '/'): Promise<{ launch_url: string; ticket: string | null }> {
    const options = { method: 'POST', body: JSON.stringify({ target_app: targetApp, return_to: returnTo }) };
    return timeoutMs === undefined ? request('/api/sso/launch', options) : requestWithTimeout('/api/sso/launch', options, timeoutMs);
  },
};
