# Kéo công việc sang lịch

Trên Workspace, kéo một công việc từ To-Do hoặc một hạn công việc từ tiện ích Lịch vào một ô
ngày trên dải T2–CN. Trong lịch Tuần đầy đủ, kéo thẻ hạn công việc vào Cả ngày hoặc
ô giờ. Đây là cập nhật hạn của công việc gốc, không tạo sự kiện
hay bản sao công việc. Không cần bảng cơ sở dữ liệu mới.

## Hành vi

- Kéo bằng tay nắm cạnh ô chọn hoặc vùng trống của dòng công việc. Các nút đánh dấu,
  sửa và xóa vẫn giữ hành vi bấm thông thường. Chuột di chuyển tối thiểu 6px
  mới bắt đầu kéo; cảm ứng giữ 250ms, có thể cuộn khi chưa kích hoạt kéo.
- Ngày đang nhận công việc có viền xanh và nhãn `Đặt hạn dd/mm`. Thả ngoài ô ngày
  hoặc nhấn Escape không cập nhật. Thả vào ngày hạn hiện có không gửi yêu cầu.
- Chỉ đổi ngày; giữ giờ hạn nếu đã có giờ. Chưa có giờ thì hạn cả ngày.
  Có thể gia hạn công việc quá hạn và kéo công việc đã hoàn thành mà vẫn giữ trạng thái.
- Trong lịch Tuần: thả vào vùng Cả ngày của một cột đặt ngày đó và xóa giờ;
  thả vào ô giờ đặt ngày và giờ theo vị trí con trỏ, làm tròn bước 15 phút.
  Khối xem trước hiển thị trước giờ sẽ lưu; hạn công việc cuối ngày tối đa 23:45. Đổi giờ trên cùng ngày
  vẫn được lưu. Thẻ có giờ tiếp tục là mốc cao 24px.
- Thẻ hạn công việc kéo bằng phần chữ/nhãn, ô chọn vẫn đánh dấu được; bấm ngắn vẫn
  mở biểu mẫu sửa. Giữ cảm ứng để kéo, di chuyển sớm để cuộn danh sách.
- Vùng Cả ngày cố định khi cuộn có ưu tiên nhận thả; ô giờ bị che dưới vùng này
  hoặc nằm ngoài phần lưới đang thấy không nhận thả nhầm.
- Thông báo nổi `Đã đặt hạn dd/mm · Hoàn tác` xuất hiện sau khi API thành công.
  Hoàn tác khôi phục ngày và giờ cũ, kể cả trạng thái không hạn. Thông báo nổi tự đóng
  sau 6 giây, tạm dừng thời gian khi rê chuột hoặc đưa vị trí bàn phím vào thông báo nổi.
- Công việc và hạn công việc cập nhật trên cả To-Do và Lịch và phiên trình duyệt khác bằng
  cơ chế thời gian thực hiện có, không cần làm mới. Nhắc hạn tính lại theo hạn và
  deadline_version mới; nhắc cũ không áp dụng cho hạn vừa đổi.
- Bàn phím: được chọn bằng bàn phím tay nắm, Space/Enter để nhấc công việc, phím mũi tên để chọn ngày,
  Home/End để chọn đầu/cuối tuần, Space/Enter để thả, Escape để hủy.

## Tổ chức

`frontend/src/features/task-calendar/` chứa phần kết nối hai chức năng:

- `TaskCalendarDndProvider.tsx`: DndContext, bộ nhận thao tác, xử lý thả, thông báo nổi và hoàn tác.
- `DraggableTask.tsx`: dòng công việc kéo được, bảo vệ các nút tương tác.
- `CalendarDropDay.tsx`: ô ngày nhận công việc và nhãn khi rê qua.
- `CalendarDeadlineDropZone.tsx`: vùng Cả ngày và ô giờ nhận hạn công việc.
- `deadlineDropTargets.ts`: dữ liệu đích và nhãn đặt hạn.
- `deadlineDropCoordinates.ts`: chọn ngày/giờ bằng bàn phím.
- `deadlineCollisionDetection.ts`: nhận đúng vùng đang thấy, xử lý hàng cố định.
- `task-calendar.css`: giao diện kéo thả, xem trước, tô sáng và thông báo nổi.

Dashboard chỉ đặt bộ cung cấp ngữ cảnh bên trong TasksProvider. TasksWidget và CalendarWidget
chỉ gắn thành phần tương ứng. Thư viện `@dnd-kit/core` xử lý chuột/cảm ứng/bàn phím.

## API và xung đột

Dùng PATCH `/api/tasks/{id}` với `due_date`, `due_time` và
`expected_deadline_version`. Máy chủ kiểm tra phiên bản dưới khóa hàng trước khi
cập nhật, trả HTTP 409 nếu hạn đã thay đổi. Thao tác thả giữ phiên bản lúc bắt đầu kéo;
Hoàn tác dùng phiên bản mà thả trả về. Vì vậy Hoàn tác không ghi đè thay đổi hạn ở phiên
khác, nhưng vẫn giữ các thay đổi tên, ưu tiên và trạng thái hoàn thành.

## Kiểm tra

```powershell
cd frontend
node tests/browser/task-calendar-dnd-browser.cjs
node tests/browser/calendar-deadline-dnd-browser.cjs
```

Bài kiểm tra trình duyệt dùng hai phiên đăng nhập độc lập, thử kéo thực tế
bằng chuột/cảm ứng/bàn phím, rê chuột, hủy, giữ giờ, gia hạn, công việc hoàn thành,
hoàn tác, xung đột, lỗi API và chiều rộng điện thoại.
Chỉ tạo/xóa các công việc được đánh dấu QA. Kiểm tra API trong
`backend/tests/integration/test_task_deadlines.py` dùng cơ sở dữ liệu độc lập.

Bài kiểm tra hạn công việc thử kéo từ tiện ích, chuyển Cả ngày/ô giờ, thay giờ cùng ngày,
khôi phục giờ bằng Hoàn tác, lưới đã cuộn, cảm ứng, bàn phím, checkbox/click sửa,
To-Do ở phiên thứ hai và tính lại nhắc hạn.

Phản hồi trực quan, cuộn mép và chuyển tuần: [drag-feedback.md](drag-feedback.md).
