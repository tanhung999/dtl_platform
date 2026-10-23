import { ApiError } from './api';
import { requestWithTimeout, RequestTimeoutError } from './requestTimeout';

export class MutationUncertainError extends Error {
  constructor() { super('Chưa xác nhận được thao tác đã hoàn tất. Giữ nguyên nội dung, kiểm tra kết nối và thử lại trên form này.'); }
}
export const isUncertainFailure = (reason: unknown) => reason instanceof RequestTimeoutError || reason instanceof TypeError;
// UI can show a short status without coupling the transport to any one form.
function checking(active: boolean) { window.dispatchEvent(new CustomEvent('mutation:checking', { detail: active })); }
export async function recoverMutation<T>(write: () => Promise<T>, inspect: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  try { return await write(); }
  catch (reason) {
    if (!isUncertainFailure(reason)) throw reason;
    checking(true);
    try {
      const latest = await inspect();
      if (matches(latest)) return latest;
      throw new MutationUncertainError();
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 409, 410].includes(error.status)) throw error;
      throw new MutationUncertainError();
    } finally { checking(false); }
  }
}
export async function deleteWithRecovery(path: string, query: URLSearchParams) {
  try { await requestWithTimeout<void>(`${path}?${query}`, { method: 'DELETE' }); }
  catch (reason) {
    if (reason instanceof ApiError && reason.status === 404) return;
    if (!isUncertainFailure(reason)) throw reason;
    checking(true);
    try { await requestWithTimeout(path, { cache: 'no-store' }, 5000); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
      throw new MutationUncertainError();
    } finally { checking(false); }
    throw new MutationUncertainError();
  }
}
export interface CreateAttempt<P> { requestId: string; original: P }
export async function createWithRecovery<T, P>(path: string, payload: P, attempt: CreateAttempt<P>, matches: (resource: T, payload: P) => boolean, update: (resource: T, payload: P) => Promise<T>) {
  const write = () => requestWithTimeout<T>(path, { method: 'POST', body: JSON.stringify({ ...attempt.original, client_request_id: attempt.requestId }) });
  let resource: T;
  try { resource = await write(); }
  catch (reason) {
    if (!isUncertainFailure(reason) || (typeof navigator !== 'undefined' && !navigator.onLine)) throw reason;
    checking(true);
    try { resource = await write(); } finally { checking(false); }
  }
  if (JSON.stringify(payload) === JSON.stringify(attempt.original)) return resource;
  if (!matches(resource, attempt.original)) throw new ApiError('Mục đã tạo có thay đổi mới. Hãy mở lại mục đó trước khi sửa.', 409);
  return update(resource, payload);
}
