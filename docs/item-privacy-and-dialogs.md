# Riêng tư và đóng hộp thoại

Task, Notes và Sự kiện dùng chung công tắc **Riêng tư**, mặc định tắt khi tạo mới. Chỉ tài khoản có quyền `calendar.share.manage` mới thấy công tắc. Giao diện dùng thông tin quyền đã tải ở trang chính, không gọi API riêng cho từng thẻ.

Backend kiểm tra quyền khi đổi trạng thái riêng tư. Nếu quyền chia sẻ bị thu hồi, các mục riêng tư cũ vẫn giữ trạng thái; người dùng vẫn sửa được nội dung mà không bị tự chuyển sang công khai.

Khi xem lịch được chia sẻ, mục riêng tư bị loại khỏi danh sách, số đếm và API chi tiết. Notes và lịch hẹn của nó đồng bộ riêng tư trong cùng giao dịch. Đổi riêng tư qua API sự kiện cũng tăng phiên bản Notes để chặn bản sửa cũ ghi đè. Thay đổi được gửi qua cơ chế realtime hiện có để bên đang xem kiểm tra lại quyền.

Migration `sharing_003_task_note_privacy` thêm `is_private` vào `tasks` và `notes`, mặc định `false`. Với ghi chú đã có lịch hẹn riêng tư, migration giữ nguyên riêng tư bằng cách chuyển trạng thái sang Notes; không đổi nội dung hoặc phiên bản cũ. Không thêm chỉ mục riêng cho cột boolean.

Hộp chi tiết, tạo/sửa, chia sẻ lịch, chọn giao diện và thông báo chỉ đóng bằng nút **X**, hoặc sau hành động chủ động như lưu thành công, xác nhận hủy/xóa hay mở một trang khác. Bấm ngoài và Esc không đóng hộp nội dung. Bộ chọn ngày/giờ vẫn đóng khi bấm ngoài hoặc Esc. Nếu quyền xem bị thu hồi hoặc mục chuyển riêng tư, nội dung đang xem phải được ẩn theo kiểm tra quyền, không chờ người dùng bấm X.

Kiểm thử:

- Backend: `tests.integration.test_item_privacy`, kiểm tra mặc định, kiểm tra quyền, lọc danh sách/chi tiết, đồng bộ hai chiều, phiên bản và migration dữ liệu cũ.
- Trình duyệt: `tests/browser/item-privacy-browser.cjs`, `calendar-sharing-browser.cjs`, `notes-delete-browser.cjs`, `event-date-time-browser.cjs`, `theme-picker-browser.cjs`.
