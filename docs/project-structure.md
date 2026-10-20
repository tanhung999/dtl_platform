# Quy ước tổ chức mã nguồn

## Phía giao diện

Mỗi chức năng có thư mục `frontend/src/features/<feature>/`, với `api.ts` là nơi khai báo đường dẫn API và lời gọi HTTP của chức năng đó. Thành phần giao diện, hàm quản lý trạng thái React và luồng nghiệp vụ gọi API qua tệp này. `types.ts` chứa kiểu dữ liệu dùng chung trong chức năng; kiểu dữ liệu không phụ thuộc vào hàm quản lý trạng thái React.

- `services/api.ts`: HTTP, lỗi API và lưu/xóa phiên đăng nhập.
- `services/requestTimeout.ts`: hủy yêu cầu và thời gian chờ dùng chung.
- `services/mutationRecovery.ts`: phục hồi kết quả thao tác khi mất phản hồi.
- `components/date-time/`: bộ chọn ngày và giờ dùng chung cho Công việc, tạo/sửa
  sự kiện và các biểu mẫu cần thêm sau này; kiểm tra định dạng và thành phần giao
  diện được đặt chung, quy tắc nghiệp vụ vẫn thuộc biểu mẫu từng chức năng.
- `features/auth/api.ts`: đăng nhập, lấy tài khoản và đăng xuất.
- `features/profile/api.ts`: hồ sơ và đổi mật khẩu.
- `features/apps/api.ts`: mở ứng dụng doanh nghiệp qua SSO; Thông báo dùng chung API này.
- Các chức năng `bookmarks`, `notes`, `tasks`, `calendar`, `notifications` có API riêng.
- `note-scheduling/`: biểu mẫu và kiểu dữ liệu lịch hẹn của ghi chú; không tự khai báo API.
- `realtime/useWorkspaceRealtime.ts`: kết nối SSE dùng chung; đây là luồng dữ liệu liên tục, không phải yêu cầu dữ liệu thông thường trong thành phần giao diện.

Giữ cơ chế thời gian chờ, chống tạo trùng khi gửi lại, phiên bản và đối soát ở đúng luồng hiện có. Di chuyển tệp không phải lý do tự thay đổi hợp đồng API hoặc quy tắc xử lý lỗi. Không thêm đường dẫn API vào thành phần giao diện/hàm quản lý trạng thái mới và không tạo lại một API đã có ở chức năng khác.

## Phía máy chủ

`app/modules/<feature>/` sở hữu bộ định tuyến và nghiệp vụ; `app/core/` chứa hạ tầng; `app/db/` chứa mô hình dữ liệu và các bản nâng cấp cơ sở dữ liệu. Lượt dọn cấu trúc này không đổi đường dẫn API, cơ sở dữ liệu hay cách lưu dữ liệu.

## Ngôn ngữ tài liệu

Viết tiêu đề, giải thích và hướng dẫn bằng tiếng Việt. Giữ nguyên tên sản phẩm, tên tệp/thư mục, định danh mã nguồn, đường dẫn API, lệnh và ví dụ mã có thể thực thi. Khi mô tả một giai đoạn cũ, ghi rõ và liên kết tới tài liệu hiện hành.

## Kiểm thử

Xem [frontend/tests/README.md](../frontend/tests/README.md) và [backend/tests/README.md](../backend/tests/README.md) cho các nhóm và lệnh chạy. Cập nhật đường dẫn trong tài liệu khi di chuyển kiểm thử. Không đặt kết quả sinh ra, bản sao cơ sở dữ liệu hoặc phụ thuộc trình duyệt vào thư mục mã nguồn.
