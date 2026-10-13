# Lịch cá nhân

Module lịch nội bộ của DTL Platform, không phụ thuộc Google Calendar hay dịch vụ bên ngoài.

Kéo task từ To-Do vào ngày trên widget Lịch: xem [Kéo công việc sang lịch](task-calendar-drag.md).
Kéo/co giãn sự kiện, sắp xếp thẻ và ghim Notes: xem [Kéo sự kiện và sắp xếp Workspace](workspace-drag-and-events.md).

## Giao diện

- Workspace: card lịch cá nhân ở cột phải, dưới Notes, xem từng ngày trong tuần.
- Tab Lịch: xem Tuần, Tháng và Danh sách (30 ngày từ ngày đang chọn).
- Bấm ô trống/nút Tạo để tạo sự kiện; bấm sự kiện để xem, sửa hoặc xóa.
- Hỗ trợ sự kiện có giờ, cả ngày, nhiều ngày, địa điểm và mô tả.
- Màu tự đổi theo thời gian: Sắp tới xanh dương `#2563EB`, Đang diễn ra xanh lá
  `#16A34A`, Đã kết thúc xám `#64748B`. Nền nhạt, viền/chấm đậm, có nhãn trạng thái.
  Mỗi phần hiển thị xét theo ngày của ô lịch: ngày đã qua xám, ngày chưa tới xanh
  dương; hôm nay xét giờ bắt đầu/kết thúc. Cùng một sự kiện nhiều ngày có thể có
  màu khác nhau ở các ngày. Cập nhật mỗi giây ở mọi chế độ xem và widget, không
  cần tải lại. Sự kiện cả ngày
  dùng biên 00:00 Việt Nam, kết thúc không bao gồm. Sự kiện đã kết thúc giảm độ
  nổi bật nhưng không gạch ngang. Deadline To-Do giữ màu theo ưu tiên.
- Tuần bắt đầu thứ Hai. Tất cả giao diện hiển thị giờ Việt Nam (UTC+7), kể cả
  khi trình duyệt dùng múi giờ khác. Mobile mặc định xem Danh sách.
- Lịch trùng giờ hiển thị cạnh nhau. Không có nhắc sự kiện, lịch lặp hay lịch chia sẻ
  trong phạm vi phiên bản đầu tiên.
- Lịch Tuần mở ở 08:00; 00:00–06:00 mặc định ẩn, công tắc “Hiện khung giờ đêm”
  nằm cạnh nút tải lại. Cột hôm nay có nền nhẹ, vạch giờ hiện tại trải hết cột.
- Cả ngày tự giãn tối đa bốn dòng, không cuộn riêng; `+n mục` mở Danh sách
  của ngày đó. Sự kiện nhiều ngày vẽ một thanh xuyên cột, bo góc 6px,
  cách dòng kế tiếp 4px. Màu nền nhạt và viền trên theo từng ngày thể hiện
  trạng thái, không dùng chấm nhỏ; tooltip ghi rõ trạng thái theo từng ngày.
  Dấu “◂” ở đầu thanh cho biết sự kiện bắt đầu trước tuần đang xem.
- Sự kiện trùng giờ trong cột hẹp chỉ hiện tên và giờ; tooltip và hộp chi tiết
  giữ trạng thái. Mini-month tô tuần đang xem, chấm đánh dấu ngày có dữ liệu.
- Công tắc Việc cần làm ở sidebar và chip số hạn dùng chung trạng thái, áp dụng
  cho Tuần/Tháng/Danh sách, ghi nhớ ở trình duyệt. Việc quá hạn chỉ hiện trong
  banner dạng dòng ngắn; không vẽ lại trong lưới hoặc danh sách ngày.
- Checkbox Sự kiện và chip số sự kiện bật/tắt sự kiện độc lập với việc cần làm,
  áp dụng cho Tuần/Tháng/Danh sách và chấm lịch nhỏ. Lựa chọn được ghi nhớ
  riêng theo ID người dùng trong localStorage, trên trình duyệt đang sử dụng.
  Sidebar chỉ có tên chủ lịch và hai checkbox cùng kiểu chữ: Sự kiện xanh dương,
  Việc cần làm cam, số lượng theo khoảng đang xem khớp chip thanh công cụ.
  Khung “Trạng thái sự kiện” tách riêng, dùng chấm 8px, không áp dụng cho deadline.
  Dữ liệu sự kiện vẫn đồng bộ realtime trong lúc ẩn, bật lại hiển thị dữ liệu mới nhất.
- Deadline To-Do hiển thị bằng dòng có checkbox và nhãn “Hạn”, đồng bộ hai chiều.
  Cả ngày và lưới giờ dùng chung cỡ chữ 12px, checkbox 14px và chấm ưu tiên;
  deadline có giờ giữ nhãn đầy đủ như “Hạn 16:56”.
  Trong lịch Tuần, deadline chưa quá hạn không giờ nằm ở hàng Cả ngày;
  có giờ nằm đúng mốc giờ trên timeline dưới dạng thẻ 24px. Sự kiện và
  deadline trùng giờ chia cột để tránh che nhau. Thẻ deadline biểu thị một mốc
  hạn, không phải thời lượng làm việc. Màu ưu tiên dùng chung `tasks/priority.css`
  với chip To-Do, có biến thể sáng/tối. Chấm ưu tiên và tooltip tên đầy đủ
  giúp đọc các thẻ hẹp. Việc đã xong giữ trên lịch, gạch ngang và giảm độ đậm.
  Đổi/xóa giờ hạn chuyển card giữa timeline và Cả ngày realtime.
  Nhắc hạn công việc, nhóm quá hạn và realtime: xem [Đồng bộ deadline](task-deadlines.md).

## Tổ chức mã nguồn

```text
backend/app/db/calendar.py                 # Bảng CalendarEvent
backend/app/modules/calendar/
  schemas.py                              # Kiểm tra và serialize dữ liệu
  router.py                               # API, truy vấn theo chủ sở hữu
frontend/src/features/calendar/
  types.ts                                # Kiểu dữ liệu riêng của lịch
  api.ts                                  # Dùng request chung, Bearer session hiện có
  dateUtils.ts                            # Ngày, múi giờ, khoảng xem, layout lịch trùng
  deadlinePlacements.ts                   # Xếp deadline có giờ cùng sự kiện trong lịch Tuần
  allDayPlacements.ts                     # Xếp thanh cả ngày/nhiều ngày và giới hạn số dòng
  hooks/useCalendarEvents.ts              # Fetch, hủy request cũ, refresh sau CRUD
  components/                             # Các chế độ xem, lịch nhỏ, hộp sự kiện
  CalendarPage.tsx                         # Trang lịch đầy đủ
  CalendarWidget.tsx                       # Widget trên Workspace
  calendar.css                            # CSS theo theme, giới hạn trong calendar
backend/tests/test_calendar.py             # API và quyền sở hữu trên DB độc lập
frontend/tests/calendar-date-utils.test.cjs # Kiểm thử ngày và layout
frontend/tests/calendar-browser.cjs        # Kiểm thử trình duyệt tùy chọn
```

Navbar và DashboardPage chỉ kết nối điều hướng/component; không chứa logic lịch.

## Database và API

Bảng mới `calendar_events` gồm ID, `user_id`, tiêu đề, mô tả, địa điểm,
`starts_at`, `ends_at`, `is_all_day`, màu và các timestamp tạo/cập nhật.
Có khóa ngoại tới `users`, index theo người dùng/thời gian và constraint
`ends_at > starts_at`. Mọi thao tác đều lọc `user_id` từ phiên đăng nhập.

Theo cơ chế khởi động hiện tại, `Base.metadata.create_all` tự tạo bảng mới khi
backend khởi động; không sửa hay xóa bảng hiện có. Dữ liệu PostgreSQL vẫn nằm
trong volume `platform_db_data`. Nếu bổ sung/sửa cột trong tương lai, cần migration
riêng vì `create_all` chỉ tạo bảng còn thiếu.

- `GET /api/calendar/events?start=<ISO8601>&end=<ISO8601>`: sự kiện giao với khoảng
  `[start, end)`, tối đa 93 ngày; cả hai thời gian phải kèm múi giờ.
- `POST /api/calendar/events`: tạo mới.
- `PUT /api/calendar/events/{id}`: cập nhật đầy đủ dữ liệu sự kiện.
- `DELETE /api/calendar/events/{id}`: xóa, trả 204.

Thời gian lưu UTC. Sự kiện cả ngày có biên lúc 00:00 giờ Việt Nam và **ngày kết
thúc không bao gồm** trong dữ liệu API. Form hiển thị ngày kết thúc bao gồm để
người dùng dễ nhập. Ví dụ chọn ngày 12–13/10 sẽ lưu kết thúc lúc 00:00 ngày 14/10.

## Chạy và kiểm tra

Áp dụng module mới vào Docker:

```bash
docker compose up -d --build --no-deps platform-backend
docker compose up -d --no-deps platform-frontend
```

Kiểm thử không thay đổi database thật:

```bash
cd backend
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

```bash
cd frontend
npm run test:calendar
npm run build
```

Kiểm thử trình duyệt tùy chọn với Microsoft Edge đã cài và Docker đang chạy:

```bash
cd frontend
npm install --prefix tests/.browser-tools --no-save --package-lock=false playwright
node tests/calendar-browser.cjs
node tests/calendar-status-browser.cjs
node tests/task-week-layout-browser.cjs
```

Script trình duyệt dùng tài khoản dev `admin/admin123`, tạo các sự kiện có nhãn
QA và dọn đúng các sự kiện đó sau khi chạy. Có thể đặt `CALENDAR_TEST_URL`,
`CALENDAR_TEST_USERNAME`, `CALENDAR_TEST_PASSWORD`, `CALENDAR_BROWSER_CHANNEL`.
Ảnh kiểm tra lưu ở `frontend/tests/artifacts/` (không đưa vào Git).
