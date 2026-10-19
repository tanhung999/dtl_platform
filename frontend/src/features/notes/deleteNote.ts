import { notesApi } from './api';
import { ApiError } from '../../services/api';
import { RequestTimeoutError } from '../../services/requestTimeout';
export class DeleteStatusUnknownError extends Error {}
export function getDeleteInfo(id: string, signal?: AbortSignal) {
  return notesApi.deleteInfo(id, signal);
}
async function verifyDeletion(id: string): Promise<boolean> {
  try { await getDeleteInfo(id); return false; }
  catch (reason) { if (reason instanceof ApiError && reason.status === 404) return true; throw new DeleteStatusUnknownError('Chưa xác định được kết quả xóa. Bạn có thể đóng hộp này hoặc kiểm tra lại khi có kết nối.'); }
}
export async function deleteNoteWithRecovery(id: string, verifyOnly = false, expectedVersion?: number) {
  if (verifyOnly) {
    if (await verifyDeletion(id)) return;
    throw new Error('Ghi chú vẫn còn khi kiểm tra. Yêu cầu trước có thể vẫn đang xử lý; bạn có thể kiểm tra lại hoặc thử xóa.');
  }
  try {
    const version = expectedVersion ?? (await getDeleteInfo(id)).version;
    await notesApi.remove(id, version);
  }
  catch (reason) {
    if (reason instanceof ApiError && reason.status === 404) return;
    if (!(reason instanceof RequestTimeoutError) && !(reason instanceof TypeError)) throw reason;
    if (await verifyDeletion(id)) return;
    throw new DeleteStatusUnknownError('Chưa nhận được xác nhận xóa; ghi chú vẫn còn khi kiểm tra. Yêu cầu trước có thể vẫn đang xử lý. Vui lòng kiểm tra lại kết quả.');
  }
}
