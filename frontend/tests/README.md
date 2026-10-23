# Kiểm thử giao diện

Chạy từ thư mục `frontend`.

```text
tests/
  unit/          Xử lý TypeScript thuần, không cần máy chủ
  browser/       Luồng giao diện bằng Playwright trên Docker đang chạy
  integration/   API và tranh chấp ghi đồng thời trên PostgreSQL
  load/          Bài đo tải chủ động
  support/       Tiện ích tạo/dọn tài khoản kiểm thử cô lập
  artifacts/     Ảnh và báo cáo, Git bỏ qua
  .browser-tools/ Playwright cài cục bộ, Git bỏ qua
```

Lệnh thông dụng:

```sh
npm test
npm run test:calendar
npm run test:deadlines
npm run test:notifications
node tests/browser/notes-reliability-browser.cjs
node tests/browser/tasks-background-refresh-browser.cjs
node tests/browser/event-date-time-browser.cjs
node tests/integration/collections-request-concurrency.cjs
node tests/integration/collection-concurrency.cjs
npm run test:load
```

`npm test` chỉ chạy toàn bộ kiểm thử đơn vị. Kiểm thử trình duyệt, tích hợp và đo tải là các nhóm chạy riêng; các nhóm dùng Docker phải có máy chủ, giao diện và cơ sở dữ liệu đang hoạt động. Cài Playwright bằng `npm install --prefix tests/.browser-tools --no-save --package-lock=false playwright`; các kịch bản trình duyệt hiện dùng Microsoft Edge.

`support/test-users.cjs` tạo tài khoản UUID riêng và dọn đúng tài khoản đó. Các bài trình duyệt cũ có biến `CALENDAR_TEST_USERNAME`, `CALENDAR_TEST_PASSWORD`, `CALENDAR_TEST_URL`; xem phần đầu kịch bản trước khi chạy. Ảnh vẫn ghi vào `tests/artifacts`, không ghi chung vào thư mục chứa mã kiểm thử.

Đã bỏ kiểm thử khung nhắc hạn cũ và tiện ích nhắc ở trình duyệt vì chức năng được thay bằng Thông báo chạy trên máy chủ. Lọc/tìm/sắp xếp Ghi chú hiện được kiểm tra qua bộ kiểm thử tích hợp máy chủ và trình duyệt, thay cho tiện ích lọc bộ nhớ cũ; kiểm thử đơn vị cho ngày hiển thị của Ghi chú vẫn được giữ.

Kiểm tra đã bỏ liên kết sự kiện và giữ đặt lịch cho ghi chú: `node tests/browser/note-scheduling-browser.cjs` (tài khoản tạm, tự dọn).

Bộ lọc Sự kiện/Ghi chú và lưu trữ kèm ngày giờ: `node tests/browser/calendar-note-filters-browser.cjs`. `tasks-background-refresh-browser.cjs` kiểm tra thêm tải đúng mốc hạn mà không cần focus và dừng khi không có mốc tiếp theo.

Chia sẻ lịch chỉ xem, riêng tư và thu hồi realtime: `node tests/browser/calendar-sharing-browser.cjs`. Bài kiểm tra tạo ba tài khoản tạm; chỉ cấp quyền quản trị cho tài khoản thử nghiệm, không sửa quyền tài khoản thật.

`calendar-sharing-browser.cjs` kiểm tra thêm giờ đêm, chi tiết nhiều ngày, thanh cả ngày liên tục, deadline dạng mốc, cập nhật nền không đóng chi tiết/đổi vị trí cuộn, cấp lại sau thu hồi và nhật ký trên trang quản trị. `unit/shared-calendar-items.test.cjs` kiểm tra khoảng thời gian, ngày kết thúc loại trừ và tách các loại mục.

Tranh chấp cấp/thu hồi lịch trên PostgreSQL: `node tests/integration/calendar-sharing-concurrency.cjs`. Đo tải đọc lịch chia sẻ riêng: `node tests/load/calendar-sharing-load.cjs` (chỉ localhost; tự tạo/dọn 300 tài khoản).

Khởi tạo SSE và gộp GET: `unit/realtime-bootstrap.test.cjs`, `unit/shared-reads.test.cjs`. Kiểm tra bản build production bằng `node tests/browser/realtime-startup-browser.cjs` sau khi build; gồm SSE chậm, commit trước kết nối, reconnect và phản hồi cũ đang bay. Luồng và giới hạn được ghi trong `docs/realtime-startup.md` ở thư mục gốc dự án.

Phạm vi cập nhật Notes: `node tests/browser/calendar-notes-invalidation-browser.cjs` kiểm tra sự kiện thường không tải lại Notes, còn sự kiện có liên kết cập nhật đúng sau sửa/dời/đổi riêng tư/xóa.

Bộ chọn theme: `node tests/browser/theme-picker-browser.cjs`. Kiểm tra bảng màu, giữ màu Notes, không tải lại API khi đổi theme, lưu lựa chọn, bàn phím, giữ mở khi Esc/bấm ngoài, nút X, Lịch đầy đủ, màn hình nhỏ và trình duyệt chặn lưu trữ. Dùng tài khoản tạm và tự dọn.

Catalog theme: `unit/theme-catalog.test.cjs` kiểm tra mở rộng theme tự động, token/preview và khởi tạo trước body. `browser/theme-picker-browser.cjs` kiểm tra thêm HTML khi chặn JavaScript của ứng dụng. Bật `THEME_PERF=1` để thu số liệu chẩn đoán blur có CPU throttle; xem `docs/themes.md`.

Bố cục cố định sau khi gỡ kéo thả: `browser/static-workspace-browser.cjs`. Đã xóa bài kéo thả riêng, chuyển bài xóa Notes sang `browser/notes-delete-browser.cjs`; vẫn giữ kiểm tra xác nhận xóa, lỗi mạng và đồng bộ. Chi tiết thay đổi database xem `docs/remove-drag-and-drop.md` ở gốc repo.

To-Do 8 mục/trang và trang đầy đủ 25 mục có tìm kiếm: `browser/task-pagination-browser.cjs`. Kiểm tra số đếm toàn bộ, giữ riêng bộ lọc/trang, và Calendar vẫn có đủ hạn ngoài trang widget.

Giữ deadline quá hạn trên lịch và đồng nhất viền Notes cả ngày/có giờ: `browser/calendar-overdue-style-browser.cjs`. Bài kiểm tra vượt mốc hạn bằng đồng hồ giả lập, kiểm tra Tuần/Tháng/Danh sách/widget/lịch chia sẻ, viền nét đứt và nền trạng thái tăng 30% ở theme sáng/tối.

Riêng tư Task/Notes/Sự kiện và đóng hộp bằng X: `browser/item-privacy-browser.cjs`. Lịch chia sẻ kiểm tra thêm chuyển riêng tư khi người nhận đang mở chi tiết; bộ chọn ngày/giờ vẫn đóng khi bấm ngoài hoặc Esc.

Dời lịch: `browser/rescheduling-browser.cjs` kiểm tra cả ba loại, giữ bản nháp/thời lượng, lý do/lịch sử riêng, Hoàn tác trong hộp đang mở, mất phản hồi sau commit, gửi trùng song song trên PostgreSQL và giao diện điện thoại. Chi tiết API tại `docs/rescheduling.md` ở gốc repo.

Hoàn tác phản hồi chậm: `browser/undo-race-browser.cjs` dùng cổng đồng bộ, kiểm tra cả thành công/lỗi cũ với toast mới. `unit/reschedule-invalidation.test.cjs` kiểm tra Sự kiện thường không tải lại Notes.

Lưu dữ liệu không thay đổi: `browser/unchanged-save-browser.cjs` kiểm tra không gửi request ghi cho Task/Note/Event/Profile và giữ giây gốc khi chỉ sửa nội dung sự kiện. Quy ước tại `docs/unchanged-updates.md` ở gốc repo.

Trạng thái form: `browser/editor-state-browser.cjs` kiểm tra nút gắn lịch/dời lịch của ghi chú mới, lịch nháp, đã lưu và lưu trữ. Dùng cổng đồng bộ để kiểm tra phản hồi tải/lưu cũ không mở đè hoặc đóng form mới ở Notes, Calendar và Tasks.

Nhắc nhở tùy chọn: `node tests/browser/user-reminders-browser.cjs`; kiểm tra Task/Event/Note mặc định không nhắc, cấu hình preset/tùy chỉnh, lưu không đổi, đóng tab vẫn tạo thông báo, mở đúng editor và bộ chọn ngày trên điện thoại. Helper chỉ chạy worker trên job của tài khoản QA UUID. Cả bài này và `notifications-browser.cjs` nhận `PLATFORM_BASE_URL` nếu kiểm tra bản build qua preview/proxy riêng.

Khóa nhắc hạn đã qua: `node tests/browser/reminder-availability-browser.cjs`. Kiểm tra Task/Event/Note chuyển xám, chỉ đổi ngày nhưng giờ còn quá khứ vẫn bị khóa, mở lại khi chọn giờ tương lai, khóa các lựa chọn nhắc đã qua, và tự khóa khi đến hạn bằng đồng hồ kiểm thử. Unit: `reminder-availability.test.cjs` kiểm tra ranh giới giờ và ngày cả ngày theo giờ Việt Nam.

Vùng bấm bộ chọn ngày/giờ: `node tests/browser/picker-hit-area-browser.cjs`. Kiểm tra vùng trống không mở hoặc mở lại popup trong Dời lịch Task/Event/Note; bấm ô, icon hoặc ArrowDown vẫn mở; bấm ngoài/Esc chỉ đóng popup và giữ hộp thoại; có kiểm tra màn hình nhỏ.

Ngày giờ đã lưu chỉ xem: `browser/rescheduling-browser.cjs` kiểm tra Task/Event/Notes khóa trường lịch, Sự kiện khóa cả lựa chọn cả ngày, sửa qua Dời lịch và Hoàn tác cập nhật lại trường bị khóa. `browser/editor-state-browser.cjs` kiểm tra tạo mới và gắn Notes vào lịch lần đầu vẫn chọn được ngày giờ; Task chưa có hạn dùng Dời lịch để đặt lịch. Các trường nhắc hạn được cấu hình riêng.

Giới hạn nhắc hạn: `browser/reminder-limits-browser.cjs` kiểm tra Task được nhắc đúng hạn, Sự kiện/Notes đang diễn ra được nhắc trước khi kết thúc; ngày/giờ vượt giới hạn hiện cảnh báo và không gửi API ghi. Kiểm tra lại khi dời lịch, độ mờ và con trỏ cấm trên toàn bộ ô ngày/giờ bị khóa.
