import { request } from '../../services/api';
import { requestWithTimeout } from '../../services/requestTimeout';
export type EnterpriseApp = 'bookingreports' | 'workflows' | 'itam';
export const appsApi = {
  launchSubApp(targetApp: EnterpriseApp, timeoutMs?: number): Promise<{ launch_url: string; ticket: string }> {
    const options = { method: 'POST', body: JSON.stringify({ target_app: targetApp }) };
    return timeoutMs === undefined ? request('/api/sso/launch', options) : requestWithTimeout('/api/sso/launch', options, timeoutMs);
  },
};
