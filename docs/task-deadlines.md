# Đồng bộ To-Do và lịch cá nhân

Task là nguồn dữ liệu duy nhất. Lịch đọc `due_date`/`due_time` từ task, không tạo
sự kiện thay thế. Task không hạn chỉ ở To-Do; có hạn xuất hiện ở Tuần/Tháng/Danh
sách và widget. Dòng deadline có checkbox, nhãn “Hạn” và giờ tùy chọn, màu theo
ưu tiên. Bấm dòng mở form sửa task; xóa task luôn yêu cầu xác nhận.

Tick ở bất kỳ nơi nào cập nhật cùng task, giữ deadline đã xong với ✓ và gạch ngang.
Đổi ngày chuyển deadline; xóa hạn giữ task nhưng bỏ dòng trên lịch. Sự kiện riêng
vẫn tạo/sửa/xóa độc lập.

## Hạn và nhắc nhở

- Múi giờ Việt Nam UTC+7. Không nhập giờ: task chỉ quá hạn khi hết ngày hạn.
- Có giờ: quá hạn khi đến giờ đã nhập. Hoàn thành không tính quá hạn.
- To-Do: chưa xong trước, hạn tăng dần, cùng hạn xếp theo ưu tiên, không hạn sau
  các việc có hạn, đã xong cuối. Badge đỏ lọc nhóm quá hạn.
- Dòng quá hạn dùng nền hồng rất nhạt và vạch đỏ bên trái, không viền đỏ bao
  quanh. Nhãn hiển thị mức trễ: không giờ tính số ngày theo lịch Việt Nam;
  có giờ tính số phút/giờ/ngày thực tế đã qua. Trạng thái này cập nhật realtime.
- Tạo nhanh và form sửa dùng chung `components/TaskDatePicker.tsx`, hiển thị
  `dd/mm/yyyy` độc lập ngôn ngữ trình duyệt, có lịch chọn ngày, xóa hạn và nhập
  trực tiếp. Ngày không hợp lệ chặn submit; API vẫn nhận ngày ISO `yyyy-mm-dd`.
- Bấm khung ngày/giờ để mở bộ chọn; bấm ra ngoài hoặc Esc để đóng. Bộ chọn giờ
  dùng chung `components/TaskTimePicker.tsx` ở tạo nhanh và form sửa, chọn giờ
  và phút, vẫn cho nhập trực tiếp và chọn giờ trước ngày. Ô giờ hiển thị cố
  định 24 giờ `HH:mm` kèm nhãn AM/PM theo giờ đã chọn, bất kể ngôn ngữ trình duyệt;
  giờ/phút không hợp lệ chặn submit. Chỉ chọn giờ khi tạo: API tự dùng ngày tạo
  task theo UTC+7. Khi sửa task không có ngày mà đặt giờ, dùng ngày task được
  tạo ban đầu. Xóa hạn vẫn xóa cả ngày và giờ; không chọn cả hai thì task không hạn.
- Lịch đầy đủ có banner Quá hạn dạng một dòng cho mỗi việc, ghi thời gian hạn
  tương đối (“05:24 hôm nay”) và số phút/giờ/ngày trễ; không vẽ lại việc này
  trong Tuần/Tháng/Danh sách. Tick hoàn thành làm việc rời banner và trở lại
  ngày hạn với trạng thái đã xong. Widget hôm nay giữ nhóm Quá hạn riêng.
- Widget xếp nhóm: Quá hạn → Cả ngày → Sự kiện theo giờ → Việc đến hạn →
  Việc đã xong. Việc trong nhóm Quá hạn không lặp ở nhóm đến hạn hôm nay.
  Các dòng việc dùng nền trung tính, vạch trái và chấm theo ưu tiên. Widget
  đặt dưới Notes ở cột phải, cao tối đa 600px (480px trên điện thoại), danh sách
  cuộn riêng. Chấm chỉ xuất hiện ở ngày có sự kiện/deadline: đỏ khi có việc
  chưa xong quá hạn hoặc Gấp, xanh khi bình thường. Dữ liệu sự kiện lấy theo
  tuần, danh sách lọc ngày đang chọn. Nhắc hạn chỉ tổng hợp hôm nay/ngày mai
  ở tiêu đề; số quá hạn giữ trong chip dẫn tới To-Do để tránh lặp thông tin.
- Nhãn ưu tiên có ký hiệu ngoài màu: ⚑ Gấp, ▲ Cao, ● Vừa, ▼ Thấp. Gấp dùng nền
  đỏ đậm chữ trắng để phân biệt trạng thái quá hạn nền hồng/viền đỏ. Light/dark
  có palette riêng; Vừa dùng chữ nâu vàng ở light mode. Việc đã xong dùng nhãn
  trung tính với opacity 0.85, không làm mờ cả dòng để giữ khả năng đọc.
- Nhắc trong ứng dụng từ 08:00 ngày trước và 08:00 ngày hạn. Nếu hạn trước 08:30,
  nhắc ngày hạn lúc trước hạn 30 phút. Mở ứng dụng muộn vẫn thấy nhắc đang có hiệu
  lực; không nhắc việc đã xong/quá hạn. Chỉ hiện giai đoạn nhắc hiện tại.
- “Ẩn nhắc này” lưu vào database cho từng task, phiên bản deadline và giai đoạn;
  không nhắc lại cùng giai đoạn sau đăng nhập. Đổi ngày/giờ tăng phiên bản và cho phép nhắc lại.
- Banner hiển thị chip hôm nay (cam), ngày mai (xanh nhạt), tên và hạn trên hai
  dòng. Tiêu đề tóm tắt số quá hạn/hôm nay/ngày mai. Quá hạn chỉ có một chip tổng,
  bấm để chuyển về Workspace, lọc To-Do quá hạn và cuộn tới danh sách; không lặp
  từng task quá hạn trong banner. Tối đa 4 chip kể cả chip tổng, có mở rộng và
  thu gọn cả banner. Quy tắc nhắc chỉ hiện khi bấm nút thông tin.
- Nút ✕ có tooltip “Ẩn nhắc này”, chỉ ẩn giai đoạn nhắc hiện tại, không hoàn thành
  task. Nút đồng hồ “Nhắc lại sau 1 giờ” tạm ẩn trên mọi tab/thiết bị; hết giờ sẽ
  nhắc lại nếu chưa hoàn thành/quá hạn. Việc đã trễ tiếp tục ở nhóm quá hạn.
- Đây là nhắc trong ứng dụng đang mở, chưa gửi email/push khi đóng ứng dụng.

## Realtime

`GET /api/workspace/stream` trả SSE có xác thực Bearer qua fetch; token không
đặt trong URL. Thông báo riêng theo người dùng, chỉ phát sau commit thành công.
PostgreSQL `LISTEN/NOTIFY` chuyển thay đổi giữa các worker; SQLite dùng hàng đợi
trong tiến trình cho phát triển. Frontend giữ một kết nối cho Workspace, cập nhật
To-Do và lịch ở mọi tab/thiết bị đang mở. Mất kết nối tự nối lại và đọc trạng thái
mới nhất. Nhắc hạn kiểm tra theo heartbeat 15 giây; trạng thái quá hạn kiểm tra
mỗi giây. Không cần tải lại trang hoặc bấm nút làm mới.

## Cấu trúc và database

- `backend/app/modules/tasks/`: API, kiểm tra đầu vào, luật hạn và nhắc hạn.
- `backend/app/db/migrations/task_deadlines.py`: migration tự chạy trước
  `create_all`, thêm cột `due_time`, `legacy_due_date`, `deadline_version` vào tasks.
- Hạn cũ “Hôm nay”/“Ngày mai”/“Tuần này” quy về ngày tạo theo UTC+7; giữ nguyên
  nhãn gốc trong `legacy_due_date`. Nhãn không xác định được giữ lại để đặt hạn
  thủ công, không tự đoán. Migration chạy lại an toàn, không xóa task.
- `backend/app/db/task_reminders.py`: bảng `task_reminder_receipts` chỉ ghi việc
  đã xem nhắc hạn; khóa duy nhất task/phiên bản/giai đoạn, xóa cùng task.
- `db/migrations/task_reminder_snooze.py` thêm `snoozed_until` vào bảng này,
  chạy lại an toàn và giữ các lần ẩn nhắc trước đó; không tạo thêm bảng.
- `backend/app/core/realtime.py` và `modules/realtime/`: phát thông báo và SSE.
- `frontend/src/features/tasks/`: API, tiện ích, context dùng chung, form, nhắc hạn.
- `frontend/src/features/realtime/`: kết nối SSE và tự kết nối lại.
- `frontend/src/features/calendar/components/DeadlineRow.tsx`, `OverdueGroup.tsx`:
  trình bày task trên lịch. Dashboard chỉ lắp ghép provider và các widget.

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
node tests/task-calendar-browser.cjs
node tests/task-priority-browser.cjs
node tests/task-reminder-banner-browser.cjs
node tests/calendar-widget-browser.cjs
node tests/task-input-browser.cjs
```

Browser QA dùng Playwright tách biệt như hướng dẫn trong `calendar.md`, chạy hai
phiên trình duyệt với múi giờ khác nhau, không reload hay bấm refresh, chỉ tạo và
dọn các task/sự kiện QA của chính lần chạy. Ảnh trong `tests/artifacts` bị Git bỏ qua.
Kiểm tra ưu tiên đo màu thực tế sau opacity của 16 nhãn ở light/dark và trạng
thái hoàn thành, yêu cầu tương phản ít nhất 4.5:1; xác nhận các cặp màu qua API
WebAIM Contrast Checker. Báo cáo trong `tests/artifacts/task-priority-contrast.json`.
