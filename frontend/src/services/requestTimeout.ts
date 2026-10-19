import { request } from './api';
export class RequestTimeoutError extends Error {
  constructor() { super('Yêu cầu mất quá nhiều thời gian. Vui lòng kiểm tra kết nối rồi thử lại.'); }
}
export async function requestWithTimeout<T>(endpoint: string, options: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try { return await request<T>(endpoint, { ...options, signal: controller.signal }); }
  catch (reason) { if (timedOut) throw new RequestTimeoutError(); throw reason; }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export class OfflineError extends Error { constructor() { super('Bạn đang ngoại tuyến. Hãy kết nối mạng rồi thử lại.'); } }
