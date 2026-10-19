export class LayoutConflictError extends Error {
  constructor(refreshed: boolean) {
    super(refreshed
      ? 'Danh sách đã thay đổi. Vui lòng kéo lại.'
      : 'Danh sách đã thay đổi nhưng chưa tải được bản mới. Vui lòng kiểm tra kết nối rồi tải lại danh sách.');
  }
}
