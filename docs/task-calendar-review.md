# Rà soát To-Do và Lịch

> Báo cáo lịch sử của lượt rà soát giới hạn ở Công việc và Lịch. Các mô tả về tải toàn bộ danh sách, nhắc hạn từ trình duyệt và kiểm tra phiên bản thuộc thời điểm đó. Cách vận hành mới xem [phân trang và phục hồi kết nối](calendar-tasks-notes-scaling.md), [đo tải](collections-capacity-300.md) và [Thông báo](notifications.md).

Phạm vi: công việc, hạn, nhắc hạn, lịch cá nhân và cơ sở dữ liệu phục vụ hai chức năng này.
Các thay đổi môi trường vận hành ở Xác thực/SSO, Ghi chú/Liên kết, Docker, phụ thuộc và CI
trong lượt rà soát đã được hoàn tác. Các chức năng có từ trước vẫn được giữ.

## Cơ sở dữ liệu

- Công việc vẫn là nguồn dữ liệu duy nhất của hạn công việc. Không tạo bản sao công việc trong
  calendar_events; sự kiện cá nhân và trạng thái công việc độc lập.
- Hạn dùng DATE và TIME, trả ISO date và HH:mm qua API như trước. Hạn không giờ
  là cả ngày; công việc không hạn không xuất hiện trên lịch. Nhãn hạn cũ vẫn giữ ở
  legacy_due_date dạng văn bản.
- Ràng buộc công việc: ưu tiên hợp lệ, deadline_version không âm, có giờ phải có ngày;
  các trường trạng thái/thứ tự/thời điểm bắt buộc không nhận NULL.
- Chỉ mục tasks(user_id,is_completed,due_date) hỗ trợ chọn việc cần nhắc.
  Lịch giữ chỉ mục theo người dùng/thời điểm bắt đầu và người dùng/thời điểm kết thúc, ràng buộc kết thúc sau bắt đầu.
- Nhắc hạn chỉ truy vấn hôm nay/ngày mai, bản ghi nhắc hạn khớp phiên bản hạn hiện hành,
  thay vì tải mọi công việc và bản ghi nhắc hạn cũ của người dùng.
- Bản nâng cấp cơ sở dữ liệu có phiên bản task_calendar_001_native_deadlines; ALTER và ràng buộc
  giới hạn ở tasks, task_reminder_receipts, calendar_events. Khóa giao dịch bảo
  vệ nâng cấp đồng thời. Khởi tạo siêu dữ liệu giữ cơ chế có từ trước của dự án.

## Phía giao diện và thời gian thực

Gói duy trì kết nối chỉ tải lại nhắc hạn; công việc thay đổi vẫn cập nhật To-Do và Lịch qua SSE.
Hàng đợi đầy gộp chủ đề cũ với chủ đề mới, tránh mất cập nhật lịch và công việc.
Kéo thả, Hoàn tác và API kiểm tra phiên bản hạn/sự kiện tiếp tục được giữ.

## Cần cân nhắc khi dữ liệu lớn

Danh sách To-Do vẫn tải toàn bộ công việc để giữ đúng số đếm, bộ lọc và lịch hiện có.
Nếu tăng tới hàng nghìn công việc mỗi người, cần thiết kế API phân trang cùng đường dẫn API
đếm và hạn công việc theo khoảng ngày; không cắt danh sách âm thầm vì sẽ sai số đếm.
Bản ghi nhắc hạn của phiên bản hạn cũ có thể cần chính sách dọn định kỳ khi dữ liệu tăng.
Lưu biểu mẫu sửa sự kiện thông thường vẫn theo cơ chế hiện có; kéo/co giãn có kiểm
tra updated_at. Có thể mở rộng kiểm tra phiên bản cho biểu mẫu nếu cần xử lý nhiều
phiên sửa cùng một sự kiện.

Báo cáo này không xác nhận toàn bộ hệ thống sẵn sàng môi trường vận hành; các phần ngoài
To-Do/Calendar đã được trả lại theo phạm vi yêu cầu.
