const labels: Record<string, string> = {
  title: 'Tiêu đề', description: 'Mô tả', content: 'Nội dung', full_name: 'Họ và tên', username: 'Tên đăng nhập',
  password: 'Mật khẩu', current_password: 'Mật khẩu hiện tại', new_password: 'Mật khẩu mới', email: 'Email',
  phone: 'Số điện thoại', job_title: 'Chức danh', office_location: 'Địa điểm làm việc', bio: 'Giới thiệu',
  url: 'Liên kết', icon: 'Biểu tượng', category: 'Nhóm', due_date: 'Ngày đến hạn', due_time: 'Giờ đến hạn',
  starts_at: 'Thời điểm bắt đầu', ends_at: 'Thời điểm kết thúc', reminder_at: 'Thời điểm nhắc hạn',
  reminder_minutes: 'Thời gian nhắc hạn', reason: 'Lý do dời lịch', priority: 'Mức ưu tiên', color: 'Màu sắc',
};
interface Issue { type?: string; loc?: unknown[]; msg?: string; ctx?: Record<string, unknown> }
const hasVietnamese = (text: string) => /[À-ỹĐđ]/.test(text);
function issueMessage(issue: Issue): string {
  const field = [...(issue.loc ?? [])].reverse().find(part => typeof part === 'string' && part !== 'body');
  const label = labels[String(field)] ?? 'Dữ liệu';
  const type = issue.type ?? '';
  if (type === 'missing') return `${label}: Vui lòng nhập thông tin bắt buộc.`;
  if (type === 'string_too_short') return `${label}: Vui lòng nhập ít nhất ${issue.ctx?.min_length ?? 1} ký tự.`;
  if (type === 'string_too_long') return `${label}: Vui lòng nhập tối đa ${issue.ctx?.max_length} ký tự.`;
  const businessMessage = issue.msg?.replace(/^Value error,\s*/, '');
  if (businessMessage && hasVietnamese(businessMessage)) return businessMessage;
  if (type.startsWith('url')) return `${label}: Vui lòng nhập liên kết http hoặc https hợp lệ.`;
  if (/date|time/.test(type)) return `${label}: Vui lòng kiểm tra lại ngày và giờ.`;
  if (type === 'extra_forbidden') return 'Biểu mẫu có thông tin không được hỗ trợ. Vui lòng tải lại trang và thử lại.';
  if (/int|float|decimal|greater_than|less_than/.test(type)) return `${label}: Vui lòng nhập một giá trị số hợp lệ trong giới hạn cho phép.`;
  return `${label}: Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.`;
}
export function apiErrorMessage(detail: unknown, status: number): string {
  if (Array.isArray(detail)) return [...new Set(detail.filter(value => value && typeof value === 'object').map(issueMessage))].slice(0, 3).join(' ') || 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.';
  if (typeof detail === 'string') {
    if (detail === 'Not Found') return 'Không tìm thấy nội dung yêu cầu.';
    if (detail === 'Forbidden') return 'Bạn không có quyền thực hiện thao tác này.';
    if (detail === 'Method Not Allowed') return 'Thao tác này không được hỗ trợ.';
    return detail;
  }
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') return detail.message;
  return `Không thể thực hiện yêu cầu (mã lỗi ${status}). Vui lòng thử lại.`;
}
