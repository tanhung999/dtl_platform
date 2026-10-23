# Gỡ chức năng kéo thả

Trang chủ dùng bố cục cố định: banner, ứng dụng doanh nghiệp, truy cập nhanh và liên kết nhanh bên trái; lịch cá nhân bên phải. Công việc và ghi chú mở ở trang riêng qua sidebar hoặc ô truy cập nhanh, không có danh sách xem trước trên trang chủ. Trên điện thoại, các phần xếp dọc. Notes hiển thị ghim trước, sau đó ngày tạo mới nhất và ID để ổn định phân trang. Đổi ghim bằng nút ghim, đổi ngày giờ bằng biểu mẫu.

Đã gỡ toàn bộ dnd-kit, provider, tay cầm, vùng thả, ghost, co giãn sự kiện, cuộn/chuyển tuần khi kéo, thông báo/hoàn tác kéo thả và API lưu thứ tự/bố cục. API PATCH lịch `/api/calendar/events/{id}/schedule` chỉ phục vụ kéo thả đã bỏ; lưu biểu mẫu vẫn dùng PUT có kiểm tra phiên bản. API nhắc hạn `/api/tasks/reminders/schedule` là chức năng khác và không bị xóa.

Migration `workspace_003_remove_drag_and_drop` xóa hai bảng `workspace_layouts`, `workspace_widget_layouts`; xóa `notes.sort_order`, `tasks.display_order`, `bookmarks.display_order`, `workspace_versions.layout` và `workspace_versions.widget_layout`. Chỉ mục Tasks được tạo lại theo thứ tự hạn/ưu tiên/ID; chỉ mục Notes dùng ghim/ngày tạo/ID. Không xóa ghi chú, sự kiện, công việc, liên kết, trạng thái ghim hay thông báo. Bảng `workspace_versions` vẫn cần cho SSE phục hồi cập nhật.

Migration chạy tự động khi khởi động backend và được kiểm thử nâng cấp lại không tái tạo bảng cũ. Các migration cũ chỉ phục vụ kéo thả đã gỡ; migration hỗn hợp vẫn giữ phần nâng cấp chức năng hiện hành. Khi triển khai phải cập nhật cả frontend và backend, dựng lại backend bằng `docker compose up -d --build platform-backend`. Bố cục/thứ tự kéo thả cũ sẽ không còn được khôi phục bởi giao diện.

Kiểm tra: `backend/tests/integration/test_remove_drag_and_drop.py`, `frontend/tests/browser/static-workspace-browser.cjs`, cùng các bài Notes, Tasks, Calendar và realtime hiện hành. Bài kéo thả cũ được xóa; các bài hỗn hợp vẫn giữ kiểm tra sửa, xóa, tìm kiếm, phân trang và phục hồi kết nối.
