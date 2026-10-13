# Rà soát To-Do và Calendar

Phạm vi: task, hạn, nhắc hạn, lịch cá nhân và database phục vụ hai feature này.
Các thay đổi production ở Auth/SSO, Notes/Bookmarks, Docker, dependency và CI
trong lượt rà soát đã được hoàn tác. Các chức năng có từ trước vẫn được giữ.

## Database

- Task vẫn là nguồn dữ liệu duy nhất của deadline. Không tạo bản sao task trong
  calendar_events; sự kiện cá nhân và trạng thái task độc lập.
- Hạn dùng DATE và TIME, trả ISO date và HH:mm qua API như trước. Hạn không giờ
  là cả ngày; task không hạn không xuất hiện trên lịch. Nhãn hạn cũ vẫn giữ ở
  legacy_due_date dạng văn bản.
- Ràng buộc task: ưu tiên hợp lệ, deadline_version không âm, có giờ phải có ngày;
  các trường trạng thái/thứ tự/thời điểm bắt buộc không nhận NULL.
- Chỉ mục tasks(user_id,is_completed,due_date) hỗ trợ chọn việc cần nhắc.
  Calendar giữ chỉ mục theo user/start và user/end, ràng buộc kết thúc sau bắt đầu.
- Nhắc hạn chỉ truy vấn hôm nay/ngày mai, receipt khớp phiên bản hạn hiện hành,
  thay vì tải mọi task và receipt cũ của người dùng.
- Migration có phiên bản task_calendar_001_native_deadlines; ALTER và ràng buộc
  giới hạn ở tasks, task_reminder_receipts, calendar_events. Khóa transaction bảo
  vệ nâng cấp đồng thời. Khởi tạo metadata giữ cơ chế có từ trước của project.

## Frontend và realtime

Heartbeat chỉ tải lại nhắc hạn; task thay đổi vẫn cập nhật To-Do và Lịch qua SSE.
Queue đầy gộp topic cũ với topic mới, tránh mất cập nhật lịch/task.
Kéo thả, Hoàn tác và API kiểm tra phiên bản hạn/sự kiện tiếp tục được giữ.

## Cần cân nhắc khi dữ liệu lớn

Danh sách To-Do vẫn tải toàn bộ task để giữ đúng số đếm, bộ lọc và lịch hiện có.
Nếu tăng tới hàng nghìn task/người, cần thiết kế API phân trang cùng endpoint
đếm và deadline theo khoảng ngày; không cắt danh sách âm thầm vì sẽ sai số đếm.
Receipt của phiên bản hạn cũ có thể cần chính sách dọn định kỳ khi dữ liệu tăng.
Lưu form sửa sự kiện thông thường vẫn theo cơ chế hiện có; kéo/co giãn có kiểm
tra updated_at. Có thể mở rộng kiểm tra phiên bản cho form nếu cần xử lý nhiều
phiên sửa cùng một sự kiện.

Báo cáo này không xác nhận toàn bộ hệ thống sẵn sàng production; các phần ngoài
To-Do/Calendar đã được trả lại theo phạm vi yêu cầu.
