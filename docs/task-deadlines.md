# Đồng bộ To-Do và lịch cá nhân

Công việc là nguồn dữ liệu duy nhất. Lịch đọc `due_date`/`due_time` từ công việc, không tạo
sự kiện thay thế. Công việc không hạn chỉ ở To-Do; có hạn xuất hiện ở Tuần/Tháng/Danh
sách và tiện ích. Dòng hạn công việc có ô chọn, nhãn “Hạn” và giờ tùy chọn, màu theo
ưu tiên. Bấm dòng mở biểu mẫu sửa công việc; xóa công việc luôn yêu cầu xác nhận.

Đánh dấu ở bất kỳ nơi nào cập nhật cùng công việc, giữ hạn công việc đã xong với ✓ và gạch ngang.
Đổi ngày chuyển hạn công việc; xóa hạn giữ công việc nhưng bỏ dòng trên lịch. Sự kiện riêng
vẫn tạo/sửa/xóa độc lập.

## Hạn và nhắc nhở

- Múi giờ Việt Nam UTC+7. Không nhập giờ: công việc chỉ quá hạn khi hết ngày hạn.
- Có giờ: quá hạn khi đến giờ đã nhập. Hoàn thành không tính quá hạn.
- To-Do: chưa xong trước, hạn tăng dần, cùng hạn xếp theo ưu tiên, không hạn sau
  các việc có hạn, đã xong cuối. Huy hiệu đỏ lọc nhóm quá hạn.
- Dòng quá hạn dùng nền hồng rất nhạt và vạch đỏ bên trái, không viền đỏ bao
  quanh. Nhãn hiển thị mức trễ: không giờ tính số ngày theo lịch Việt Nam;
  có giờ tính số phút/giờ/ngày thực tế đã qua. Trạng thái này cập nhật thời gian thực.
- Tạo nhanh và biểu mẫu sửa dùng chung `frontend/src/components/date-time/DatePicker.tsx`, hiển thị
  `dd/mm/yyyy` độc lập ngôn ngữ trình duyệt, có lịch chọn ngày, xóa hạn và nhập
  trực tiếp. Ngày không hợp lệ chặn gửi biểu mẫu; API vẫn nhận ngày ISO `yyyy-mm-dd`.
- Bấm khung ngày/giờ để mở bộ chọn; bấm ra ngoài hoặc Esc để đóng. Bộ chọn giờ
  dùng chung `frontend/src/components/date-time/TimePicker.tsx` ở tạo nhanh và biểu mẫu sửa, chọn giờ
  và phút, vẫn cho nhập trực tiếp và chọn giờ trước ngày. Ô giờ hiển thị cố
  định 24 giờ `HH:mm` kèm nhãn AM/PM theo giờ đã chọn, bất kể ngôn ngữ trình duyệt;
  giờ/phút không hợp lệ chặn gửi biểu mẫu. Chỉ chọn giờ khi tạo: API tự dùng ngày tạo
  công việc theo UTC+7. Khi sửa công việc không có ngày mà đặt giờ, dùng ngày công việc được
  tạo ban đầu. Xóa hạn vẫn xóa cả ngày và giờ; không chọn cả hai thì công việc không hạn.
- Lịch đầy đủ có khung thông báo Quá hạn dạng một dòng cho mỗi việc, ghi thời gian hạn
  tương đối (“05:24 hôm nay”) và số phút/giờ/ngày trễ; không vẽ lại việc này
  trong Tuần/Tháng/Danh sách. Đánh dấu hoàn thành làm việc rời khung thông báo và trở lại
  ngày hạn với trạng thái đã xong. Tiện ích hôm nay giữ nhóm Quá hạn riêng.
- Tiện ích xếp nhóm: Quá hạn → Cả ngày → Sự kiện theo giờ → Việc đến hạn →
  Việc đã xong. Việc trong nhóm Quá hạn không lặp ở nhóm đến hạn hôm nay.
  Các dòng việc dùng nền trung tính, vạch trái và chấm theo ưu tiên. Tiện ích
  mặc định đặt phía trên Ghi chú ở cột phải, cao tối đa 600px (480px trên điện thoại), danh sách
  cuộn riêng. Chấm chỉ xuất hiện ở ngày có sự kiện hoặc hạn công việc: đỏ khi có việc
  chưa xong quá hạn hoặc Gấp, xanh khi bình thường. Dữ liệu sự kiện lấy theo
  tuần, danh sách lọc ngày đang chọn. Nhắc hạn chỉ tổng hợp hôm nay/ngày mai
  ở tiêu đề; số quá hạn giữ trong nhãn dẫn tới To-Do để tránh lặp thông tin.
- Nhãn ưu tiên có ký hiệu ngoài màu: ⚑ Gấp, ▲ Cao, ● Vừa, ▼ Thấp. Gấp dùng nền
  đỏ đậm chữ trắng để phân biệt trạng thái quá hạn nền hồng/viền đỏ. Chế độ sáng/tối
  có bảng màu riêng; Vừa dùng chữ nâu vàng ở chế độ sáng. Việc đã xong dùng nhãn
  trung tính với độ đậm 0.85, không làm mờ cả dòng để giữ khả năng đọc.
- Nhắc hạn hiện thuộc mô-đun Thông báo, mở từ biểu tượng chuông; không còn khung nhắc hạn riêng trên trang. Máy chủ tạo thông báo lúc 08:00 ngày trước và ngày hạn; nếu hạn trước 08:30 thì nhắc trước hạn 30 phút. Có thêm thông báo khi quá hạn.
- Thông báo lưu theo tài khoản; đóng thẻ trình duyệt hoặc tắt máy vẫn nhận được nếu máy chủ đang chạy. Đọc/ẩn thông báo không đánh dấu hoàn thành. Có thể nhắc lại sau một giờ nếu trước hạn còn hơn một giờ.
- Việc đổi hạn, hoàn thành hoặc xóa làm mất hiệu lực tác vụ nhắc cũ; lịch sử thông báo vẫn giữ và ghi rõ trạng thái mới. Chi tiết lịch gửi, bảo mật và tích hợp ứng dụng doanh nghiệp xem [Thông báo](notifications.md).

## Cập nhật thời gian thực

`GET /api/workspace/stream` trả SSE, mở bằng `fetch` có xác thực Bearer; mã phiên không
đặt trong URL. Thông báo riêng theo người dùng, chỉ phát sau xác nhận giao dịch thành công.
PostgreSQL `LISTEN/NOTIFY` chuyển thay đổi giữa các tiến trình máy chủ; SQLite dùng hàng đợi
trong tiến trình cho phát triển. Giao diện giữ một kết nối cho Workspace, cập nhật
To-Do và lịch ở mọi tab/thiết bị đang mở. Mất kết nối tự nối lại và đọc trạng thái
mới nhất. Gói duy trì kết nối không truy vấn lại dữ liệu. Tiến trình nhắc hạn chạy ở máy chủ;
đồng hồ giao diện công việc cập nhật theo phút, trạng thái và số đếm làm mới qua SSE. Không cần tải lại trang hoặc bấm nút làm mới.

## Cấu trúc và cơ sở dữ liệu

- `backend/app/modules/tasks/`: API, kiểm tra đầu vào, luật hạn và nhắc hạn.
- `backend/app/db/migrations/task_deadlines.py`: bản nâng cấp cơ sở dữ liệu tự chạy trước
  `create_all`, thêm cột `due_time`, `legacy_due_date`, `deadline_version` vào tasks.
- Hạn cũ “Hôm nay”/“Ngày mai”/“Tuần này” quy về ngày tạo theo UTC+7; giữ nguyên
  nhãn gốc trong `legacy_due_date`. Nhãn không xác định được giữ lại để đặt hạn
  thủ công, không tự đoán. Bản nâng cấp cơ sở dữ liệu chạy lại an toàn, không xóa công việc.
- `backend/app/db/task_reminders.py`: bảng `task_reminder_receipts` chỉ ghi việc
  đã xem nhắc hạn; khóa duy nhất công việc/phiên bản/giai đoạn, xóa cùng công việc.
- `db/migrations/task_reminder_snooze.py` thêm `snoozed_until` vào bảng này,
  chạy lại an toàn và giữ các lần ẩn nhắc trước đó; không tạo thêm bảng.
- `backend/app/core/realtime.py` và `modules/realtime/`: phát thông báo và SSE.
- `frontend/src/features/tasks/`: API, tiện ích, ngữ cảnh dùng chung và biểu mẫu. Phần nhắc hạn ở `features/notifications/`.
- `frontend/src/features/realtime/`: kết nối SSE và tự kết nối lại.
- `frontend/src/features/calendar/components/DeadlineRow.tsx`, `OverdueGroup.tsx`:
  trình bày công việc trên lịch. Dashboard chỉ lắp ghép bộ cung cấp ngữ cảnh và các tiện ích.

Không dùng Google API và không có bảng tài khoản Google.

## Kiểm tra

```bash
cd backend
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

```bash
cd frontend
npm run test:calendar
npm run test:deadlines
node tests/browser/task-calendar-browser.cjs
node tests/browser/task-priority-browser.cjs
node tests/browser/notifications-browser.cjs
node tests/browser/calendar-widget-browser.cjs
node tests/browser/task-input-browser.cjs
```

Kiểm thử giao diện dùng Playwright tách biệt như hướng dẫn trong `calendar.md`, chạy hai
phiên trình duyệt với múi giờ khác nhau, không tải lại hay bấm làm mới, chỉ tạo và
dọn các task/sự kiện QA của chính lần chạy. Ảnh trong `tests/artifacts` bị Git bỏ qua.
Kiểm tra ưu tiên đo màu thực tế sau độ đậm của 16 nhãn ở light/dark và trạng
thái hoàn thành, yêu cầu tương phản ít nhất 4.5:1; xác nhận các cặp màu qua API
WebAIM Contrast Checker. Báo cáo trong `tests/artifacts/task-priority-contrast.json`.
