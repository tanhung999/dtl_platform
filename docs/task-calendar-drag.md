# Kéo công việc sang lịch

Trên Workspace, kéo một task từ To-Do hoặc một deadline từ widget Lịch vào một ô
ngày trên dải T2–CN. Trong lịch Tuần đầy đủ, kéo thẻ deadline vào Cả ngày hoặc
ô giờ. Đây là cập nhật hạn của task gốc, không tạo sự kiện
hay bản sao task. Không cần bảng database mới.

## Hành vi

- Kéo bằng tay nắm cạnh checkbox hoặc vùng trống của dòng task. Các nút tick,
  sửa và xóa vẫn giữ hành vi click thông thường. Chuột di chuyển tối thiểu 6px
  mới bắt đầu kéo; cảm ứng giữ 250ms, có thể cuộn khi chưa kích hoạt kéo.
- Ngày đang nhận task có viền xanh và nhãn `Đặt hạn dd/mm`. Thả ngoài ô ngày
  hoặc nhấn Escape không cập nhật. Thả vào ngày hạn hiện có không gửi request.
- Chỉ đổi ngày; giữ giờ hạn nếu đã có giờ. Chưa có giờ thì hạn cả ngày.
  Có thể gia hạn task quá hạn và kéo task đã hoàn thành mà vẫn giữ trạng thái.
- Trong lịch Tuần: thả vào vùng Cả ngày của một cột đặt ngày đó và xóa giờ;
  thả vào ô giờ đặt ngày và giờ theo vị trí con trỏ, làm tròn bước 15 phút.
  Ghost hiển thị trước giờ sẽ lưu; deadline cuối ngày tối đa 23:45. Đổi giờ trên cùng ngày
  vẫn được lưu. Thẻ có giờ tiếp tục là mốc cao 24px.
- Thẻ deadline kéo bằng phần chữ/nhãn, checkbox vẫn tick được; click ngắn vẫn
  mở form sửa. Giữ cảm ứng để kéo, di chuyển sớm để cuộn danh sách.
- Vùng Cả ngày cố định khi cuộn có ưu tiên nhận thả; ô giờ bị che dưới vùng này
  hoặc nằm ngoài phần lưới đang thấy không nhận thả nhầm.
- Toast `Đã đặt hạn dd/mm · Hoàn tác` xuất hiện sau khi API thành công.
  Hoàn tác khôi phục ngày và giờ cũ, kể cả trạng thái không hạn. Toast tự đóng
  sau 6 giây, tạm dừng thời gian khi rê chuột hoặc focus vào toast.
- Task và deadline cập nhật trên cả To-Do/Lịch và phiên trình duyệt khác bằng
  cơ chế realtime hiện có, không cần refresh. Nhắc hạn tính lại theo hạn và
  deadline_version mới; nhắc cũ không áp dụng cho hạn vừa đổi.
- Bàn phím: focus tay nắm, Space/Enter để nhấc task, phím mũi tên để chọn ngày,
  Home/End để chọn đầu/cuối tuần, Space/Enter để thả, Escape để hủy.

## Tổ chức

`frontend/src/features/task-calendar/` chứa phần kết nối hai feature:

- `TaskCalendarDndProvider.tsx`: DndContext, sensor, xử lý drop, toast và undo.
- `DraggableTask.tsx`: dòng task kéo được, bảo vệ các nút tương tác.
- `CalendarDropDay.tsx`: ô ngày nhận task và nhãn khi rê qua.
- `CalendarDeadlineDropZone.tsx`: vùng Cả ngày và ô giờ nhận deadline.
- `deadlineDropTargets.ts`: dữ liệu đích và nhãn đặt hạn.
- `deadlineDropCoordinates.ts`: chọn ngày/giờ bằng bàn phím.
- `deadlineCollisionDetection.ts`: nhận đúng vùng đang thấy, xử lý hàng cố định.
- `task-calendar.css`: giao diện kéo thả, preview, highlight và toast.

Dashboard chỉ đặt provider bên trong TasksProvider. TasksWidget và CalendarWidget
chỉ gắn component tương ứng. Thư viện `@dnd-kit/core` xử lý chuột/cảm ứng/bàn phím.

## API và xung đột

Dùng PATCH `/api/tasks/{id}` với `due_date`, `due_time` và
`expected_deadline_version`. Backend kiểm tra phiên bản dưới khóa row trước khi
cập nhật, trả HTTP 409 nếu hạn đã thay đổi. Drop giữ phiên bản lúc bắt đầu kéo;
Undo dùng phiên bản mà drop trả về. Vì vậy Undo không ghi đè thay đổi hạn ở phiên
khác, nhưng vẫn giữ các thay đổi tên, ưu tiên và trạng thái hoàn thành.

## Kiểm tra

```powershell
cd frontend
node tests/task-calendar-dnd-browser.cjs
node tests/calendar-deadline-dnd-browser.cjs
```

Bài kiểm tra trình duyệt dùng hai phiên đăng nhập độc lập, thử kéo thực tế
bằng chuột/cảm ứng/bàn phím, hover, hủy, giữ giờ, gia hạn, task hoàn thành,
undo, xung đột, lỗi API và chiều rộng mobile.
Chỉ tạo/xóa các task được đánh dấu QA. Kiểm tra API trong
`backend/tests/test_task_deadlines.py` dùng database độc lập.

Bài kiểm tra deadline thử kéo từ widget, chuyển Cả ngày/ô giờ, thay giờ cùng ngày,
khôi phục giờ bằng Undo, lưới đã cuộn, cảm ứng, bàn phím, checkbox/click sửa,
To-Do ở phiên thứ hai và tính lại nhắc hạn.

Phản hồi trực quan, cuộn mép và chuyển tuần: [drag-feedback.md](drag-feedback.md).
