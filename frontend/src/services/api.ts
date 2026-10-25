import { apiErrorMessage } from './validationErrors';
import { AuthSession, User } from '../types';
import { SharedReads } from './sharedReads';
import { readScopes, workspaceBootstrap } from './realtimeBootstrap';

export class ApiError extends Error { constructor(message: string, public status: number, public current?: any) { super(message); } }

const TOKEN_KEY = 'dtl_platform_token';
const USER_KEY = 'dtl_platform_user';
const reads = new SharedReads();
let sessionGeneration = 0;
let writeGeneration = 0;
export const getSessionKey = () => `${sessionGeneration}:${getStoredToken() ?? ''}`;
export function ensureWorkspaceSession() {
  const key = getSessionKey();
  reads.setSession(key); workspaceBootstrap.setSession(key);
  return key;
}
function sessionChanged() {
  sessionGeneration++; ensureWorkspaceSession();
  window.dispatchEvent(new Event('session:changed'));
}

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
  sessionChanged();
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionChanged();
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if ((options.method ?? 'GET').toUpperCase() !== 'GET') writeGeneration++;
  const session = ensureWorkspaceSession();
  const checkSession = () => { if (getSessionKey() !== session) throw new DOMException('Session changed', 'AbortError'); };
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const execute = async (signal?: AbortSignal | null): Promise<T> => {
    const scopes = (options.method ?? 'GET').toUpperCase() === 'GET' ? readScopes(endpoint) : [];
    if (token && scopes.length) await workspaceBootstrap.wait(signal);
    checkSession();
    const response = await fetch(endpoint, {
      ...options,
      credentials: options.credentials ?? 'same-origin',
      signal,
      headers,
    });
    checkSession();

    if (response.status === 401 && endpoint !== '/api/auth/login') {
      clearSession();
      // Dispatch auth state change or reload
      window.dispatchEvent(new Event('auth:unauthorized'));
      throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json().catch(() => null);
    checkSession();

    if (!response.ok) {
      const detail = data?.detail;
      throw new ApiError(apiErrorMessage(detail, response.status), response.status, detail?.current);
    }

    if (scopes.length) {
      const snapshot = response.headers.get('X-Workspace-Versions');
      if (snapshot) {
        try { workspaceBootstrap.observeRead(endpoint, JSON.parse(snapshot)); } catch { /* Invalid metadata never blocks a resource read. */ }
      }
    }
    return data as T;
  };
  if ((options.method ?? 'GET').toUpperCase() !== 'GET') return execute(options.signal);
  const separator = endpoint.indexOf('?');
  const path = separator < 0 ? endpoint : endpoint.slice(0, separator);
  const query = separator < 0 ? '' : endpoint.slice(separator + 1);
  const params = new URLSearchParams(query); params.sort();
  // A refresh after a write/event must not join an older in-flight snapshot.
  const key = JSON.stringify([path, params.toString(), [...headers.entries()].sort(), options.cache, options.credentials, options.mode, options.redirect, options.integrity, options.referrer, options.referrerPolicy, writeGeneration, workspaceBootstrap.revision]);
  return reads.run(key, session, options.signal, execute);
}
