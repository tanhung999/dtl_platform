# Lịch cá nhân

Mô-đun lịch nội bộ của DTL Platform, không phụ thuộc Google Lịch hay dịch vụ bên ngoài.

Kéo công việc từ To-Do vào ngày trên tiện ích Lịch: xem [Kéo công việc sang lịch](task-calendar-drag.md).
Kéo/co giãn sự kiện, sắp xếp thẻ và ghim Ghi chú: xem [Kéo sự kiện và sắp xếp Workspace](workspace-drag-and-events.md).

## Giao diện

- Workspace: thẻ lịch cá nhân ở cột phải, phía trên Ghi chú, xem từng ngày trong tuần.
- Tab Lịch: xem Tuần, Tháng và Danh sách (30 ngày từ ngày đang chọn).
- Bấm ô trống/nút Tạo để tạo sự kiện; bấm sự kiện để xem, sửa hoặc xóa.
- Tạo/sửa sự kiện dùng chung bộ chọn ngày giờ với To-Do tại
  `frontend/src/components/date-time/`. Ngày hiển thị `dd/mm/yyyy`; giờ 24 giờ
  `HH:mm` kèm AM/PM. Bấm ô hoặc biểu tượng để mở, bấm ngoài hoặc Escape để đóng
  bộ chọn trước khi đóng biểu mẫu. Ngày bắt đầu/kết thúc là bắt buộc; ngày kết
  thúc không được trước ngày bắt đầu. Sự kiện có giờ bắt buộc nhập cả hai giờ,
  thời điểm kết thúc phải sau bắt đầu. Sự kiện cả ngày không hiện ô giờ và vẫn
  tính ngày kết thúc trên biểu mẫu là ngày bao gồm.
- Hỗ trợ sự kiện có giờ, cả ngày, nhiều ngày, địa điểm và mô tả.
- Màu tự đổi theo thời gian: Sắp tới xanh dương `#2563EB`, Đang diễn ra xanh lá
  `#16A34A`, Đã kết thúc xám `#64748B`. Nền nhạt, viền hoặc chấm đậm, có nhãn trạng thái.
  Mỗi phần hiển thị xét theo ngày của ô lịch: ngày đã qua xám, ngày chưa tới xanh
  dương; hôm nay xét giờ bắt đầu/kết thúc. Cùng một sự kiện nhiều ngày có thể có
  màu khác nhau ở các ngày. Cập nhật mỗi giây ở mọi chế độ xem và tiện ích, không
  cần tải lại. Sự kiện cả ngày
  dùng biên 00:00 Việt Nam, kết thúc không bao gồm. Sự kiện đã kết thúc giảm độ
  nổi bật nhưng không gạch ngang. Hạn công việc To-Do giữ màu theo ưu tiên.
- Tuần bắt đầu thứ Hai. Tất cả giao diện hiển thị giờ Việt Nam (UTC+7), kể cả
  khi trình duyệt dùng múi giờ khác. Điện thoại mặc định xem Danh sách.
- Lịch trùng giờ hiển thị cạnh nhau. Không có nhắc sự kiện, lịch lặp hay lịch chia sẻ
  trong phạm vi phiên bản đầu tiên.
- Lịch Tuần mở ở 08:00; 00:00–06:00 mặc định ẩn, công tắc “Hiện khung giờ đêm”
  nằm cạnh nút tải lại. Cột hôm nay có nền nhẹ, vạch giờ hiện tại trải hết cột.
- Cả ngày tự giãn tối đa bốn dòng, không cuộn riêng; `+n mục` mở Danh sách
  của ngày đó. Sự kiện nhiều ngày vẽ một thanh xuyên cột, bo góc 6px,
  cách dòng kế tiếp 4px. Màu nền nhạt và viền trên theo từng ngày thể hiện
  trạng thái, không dùng chấm nhỏ; chú thích khi rê chuột ghi rõ trạng thái theo từng ngày.
  Dấu “◂” ở đầu thanh cho biết sự kiện bắt đầu trước tuần đang xem.
  Dấu “▸” ở cuối thanh cho biết sự kiện còn kéo dài sang tuần sau. Sự kiện kết
  thúc đúng 00:00 thứ Hai kế tiếp không có dấu này vì thời điểm kết thúc không bao gồm.
- Sự kiện trùng giờ trong cột hẹp chỉ hiện tên và giờ; chú thích khi rê chuột và hộp chi tiết
  giữ trạng thái. Lịch tháng nhỏ tô tuần đang xem, chấm đánh dấu ngày có dữ liệu.
- Công tắc Việc cần làm ở thanh bên và nhãn số hạn dùng chung trạng thái, áp dụng
  cho Tuần/Tháng/Danh sách, ghi nhớ ở trình duyệt. Việc quá hạn chỉ hiện trong
  khung thông báo dạng dòng ngắn; không vẽ lại trong lưới hoặc danh sách ngày.
- Ô chọn Sự kiện và nhãn số sự kiện bật/tắt sự kiện độc lập với việc cần làm,
  áp dụng cho Tuần/Tháng/Danh sách và chấm lịch nhỏ. Lựa chọn được ghi nhớ
  riêng theo ID người dùng trong localStorage, trên trình duyệt đang sử dụng.
  Sidebar chỉ có tên chủ lịch và hai ô chọn cùng kiểu chữ: Sự kiện xanh dương,
  Việc cần làm cam, số lượng theo khoảng đang xem khớp nhãn thanh công cụ.
  Khung “Trạng thái sự kiện” tách riêng, dùng chấm 8px, không áp dụng cho hạn công việc.
  Dữ liệu sự kiện vẫn đồng bộ thời gian thực trong lúc ẩn, bật lại hiển thị dữ liệu mới nhất.
- Hạn công việc To-Do hiển thị bằng dòng có ô chọn và nhãn “Hạn”, đồng bộ hai chiều.
  Cả ngày và lưới giờ dùng chung cỡ chữ 12px, ô chọn 14px và chấm ưu tiên;
  hạn công việc có giờ giữ nhãn đầy đủ như “Hạn 16:56”.
  Trong lịch Tuần, hạn công việc chưa quá hạn không giờ nằm ở hàng Cả ngày;
  có giờ nằm đúng mốc giờ trên lưới giờ dưới dạng thẻ 24px. Sự kiện và
  hạn công việc trùng giờ chia cột để tránh che nhau. Thẻ hạn công việc biểu thị một mốc
  hạn, không phải thời lượng làm việc. Màu ưu tiên dùng chung `tasks/priority.css`
  với nhãn To-Do, có biến thể sáng/tối. Chấm ưu tiên và chú thích khi rê chuột tên đầy đủ
  giúp đọc các thẻ hẹp. Việc đã xong giữ trên lịch, gạch ngang và giảm độ đậm.
  Đổi/xóa giờ hạn chuyển thẻ giữa lưới giờ và Cả ngày thời gian thực.
  Nhắc hạn công việc, nhóm quá hạn và thời gian thực: xem [Đồng bộ hạn công việc](task-deadlines.md).

## Tổ chức mã nguồn

```text
backend/app/db/calendar.py                 # Bảng CalendarEvent
backend/app/modules/calendar/
  schemas.py                              # Kiểm tra và chuyển đổi dữ liệu trả về
  router.py                               # API, truy vấn theo chủ sở hữu
frontend/src/features/calendar/
  types.ts                                # Kiểu dữ liệu riêng của lịch
  api.ts                                  # HTTP dùng chung và phiên Bearer hiện có
  dateUtils.ts                            # Ngày, múi giờ, khoảng xem, bố cục lịch trùng
  deadlinePlacements.ts                   # Xếp hạn có giờ cùng sự kiện trong lịch Tuần
  allDayPlacements.ts                     # Xếp thanh cả ngày/nhiều ngày và giới hạn số dòng
  hooks/useCalendarEvents.ts              # Tải dữ liệu, hủy yêu cầu cũ, làm mới sau thay đổi
  components/                             # Các chế độ xem, lịch nhỏ, hộp sự kiện
  CalendarPage.tsx                         # Trang lịch đầy đủ
  CalendarWidget.tsx                       # Tiện ích trên Workspace
  calendar.css                            # CSS theo giao diện màu, giới hạn trong lịch
backend/tests/integration/test_calendar.py             # API và quyền sở hữu trên DB độc lập
frontend/tests/unit/calendar-date-utils.test.cjs # Kiểm thử ngày và bố cục
frontend/tests/browser/calendar-browser.cjs        # Kiểm thử trình duyệt tùy chọn
```

Navbar và DashboardPage chỉ kết nối điều hướng/component; không chứa xử lý lịch.

## Cơ sở dữ liệu và API

Bảng mới `calendar_events` gồm ID, `user_id`, tiêu đề, mô tả, địa điểm,
`starts_at`, `ends_at`, `is_all_day`, màu và các dấu thời gian tạo/cập nhật.
Có khóa ngoại tới `users`, chỉ mục theo người dùng/thời gian và ràng buộc
`ends_at > starts_at`. Mọi thao tác đều lọc `user_id` từ phiên đăng nhập.

Theo cơ chế khởi động hiện tại, `Base.metadata.create_all` tự tạo bảng mới khi
máy chủ khởi động; không sửa hay xóa bảng hiện có. Dữ liệu PostgreSQL vẫn nằm
trong volume `platform_db_data`. Nếu bổ sung/sửa cột trong tương lai, cần bản nâng cấp cơ sở dữ liệu
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

Áp dụng mô-đun mới vào Docker:

```bash
docker compose up -d --build --no-deps platform-backend
docker compose up -d --no-deps platform-frontend
```

Kiểm thử không thay đổi cơ sở dữ liệu thật:

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
node tests/browser/calendar-browser.cjs
node tests/browser/calendar-status-browser.cjs
node tests/browser/task-week-layout-browser.cjs
node tests/browser/event-date-time-browser.cjs
```

Kịch bản trình duyệt dùng tài khoản phát triển `admin/admin123`, tạo các sự kiện có nhãn
QA và dọn đúng các sự kiện đó sau khi chạy. Có thể đặt `CALENDAR_TEST_URL`,
`CALENDAR_TEST_USERNAME`, `CALENDAR_TEST_PASSWORD`, `CALENDAR_BROWSER_CHANNEL`.
Ảnh kiểm tra lưu ở `frontend/tests/artifacts/` (không đưa vào Git).
