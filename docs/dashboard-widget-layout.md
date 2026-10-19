# Bố cục tiện ích Workspace

Kéo bằng tay cầm nhỏ ở giữa cạnh trên tiện ích để đổi thứ tự hoặc chuyển cột.
Tay cầm hiện khi rê chuột, được chọn bằng bàn phím hoặc dùng màn hình cảm ứng.
Bàn phím: Space bắt đầu, mũi tên chọn tiện ích hoặc cột, Space thả, Escape hủy.
Cột trống vẫn nhận tiện ích. Có Hoàn tác; API lỗi thì bố cục tự hoàn lại.
Không thêm nút đặt lại.

Điện thoại (<=768px) hiển thị một cột, tắt thao tác kéo cả tiện ích và giữ nguyên cấu hình
máy tính trên máy chủ. Kéo các mục bên trong tiện ích vẫn dùng luồng riêng hiện có.

## Dữ liệu

`workspace_widget_layouts` lưu một hàng cho mỗi người dùng, khóa ngoại xóa theo người dùng:
- `columns`: JSON chứa ID tiện ích theo từng cột `launcher`, `tasks`, `notes`.
- `schema_version`: định dạng JSON, hiện là 1.
- `version`: tăng sau mỗi lần lưu, kiểm tra qua `expected_version` để chống ghi đè.

`GET/PUT /api/workspace/widgets` yêu cầu đăng nhập và chỉ truy cập người dùng hiện tại.
Đọc/lưu luôn hợp nhất với danh mục đăng ký: bỏ tiện ích đã gỡ, loại trùng, thêm tiện ích còn
thiếu vào cuối cột mặc định. Tiện ích ở cột không hợp lệ trở về cột mặc định.
GET không tự tăng phiên bản. Định dạng chưa hỗ trợ trả 409, không ghi đè dữ liệu.
Thay đổi phát chủ đề thời gian thực `widget-layout` sau xác nhận giao dịch; kết nối lại cũng tải lại.
Bản nâng cấp cơ sở dữ liệu `workspace_002_widget_layout` tạo bảng riêng, không thay đổi thứ tự mục.

ID tiện ích phải giữ nguyên khi đổi tên. Khi thêm/gỡ tiện ích, cập nhật danh mục đăng ký máy chủ
`modules/workspace/widget_layout.py`, giao diện `dashboard-layout/widgetLayout.ts`
và phần dựng giao diện nội dung trong `WorkspaceWidgets.tsx`.

## Giao diện

`dashboard-layout/` quản lý việc kéo tiện ích, độc lập với `workspace-layout/` quản lý
thứ tự Ứng dụng, Liên kết và Ghi chú. Mỗi tiện ích có phần tử chứa cổng hiển thị cố định để giữ biểu mẫu, bộ lọc
và trạng thái lịch khi chuyển cột. Khung tiện ích dùng `DndContext` bên ngoài; nội dung
được hiển thị qua cổng React dùng `TaskCalendarDndProvider` bên trong để kéo công việc hoặc hạn công việc không kích hoạt
kéo cả tiện ích. Mọi thao tác lưu đều có hoàn tác giao dịch và kiểm tra phiên bản.

## Kiểm thử

- Máy chủ: `python -m unittest discover -s tests -p "test_widget_layout.py" -v`.
- Xử lý giao diện: `node --test tests/unit/widget-layout.test.cjs`.
- Trình duyệt: `node tests/browser/dashboard-widgets-browser.cjs` (Docker đang chạy).
- Hồi quy: `workspace-drag-browser.cjs`, `task-calendar-dnd-browser.cjs`,
  `calendar-event-dnd-browser.cjs` trong thư mục frontend/tests.

Kiểm thử trình duyệt tạo tài khoản kiểm thử riêng rồi xóa đúng các tài khoản đó; không đổi bố cục tài khoản thật.
