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

Bộ chọn bảy theme: `node tests/browser/theme-picker-browser.cjs`. Kiểm tra bảng màu, giữ màu Notes, không tải lại API khi đổi theme, lưu lựa chọn, bàn phím/Esc/bấm ngoài, Lịch đầy đủ, màn hình nhỏ và trình duyệt chặn lưu trữ. Dùng tài khoản tạm và tự dọn.
