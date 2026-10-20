# Dọn mã nguồn và tối ưu ngày 20/10/2026

## Lịch sử thay đổi lịch

Các API PATCH Task, PATCH Notes và PUT Event dùng chung service cập nhật với API Dời lịch. Thay đổi ngày/giờ trong form thông thường cũng lưu lịch sử trong cùng transaction; sửa nội dung hoặc lưu lại cùng ngày/giờ không tạo dòng lịch sử mới. Lần gắn lịch đầu tiên cho ghi chú mới chưa có lịch được xem là khởi tạo lịch hẹn, không phải dời lịch.

Khi sửa lịch hẹn ghi chú qua Event API, lịch sử thuộc Notes. Nút Dời lịch tự lưu lý do và mã yêu cầu; service bên dưới không ghi trùng dòng lịch sử. Hoàn tác đánh dấu bản ghi gốc, không tạo thêm một lần dời lịch giả.

Hàm cập nhật không còn được nhập từ router khác. Mã chung nằm trong `modules/{tasks,notes,calendar}/service.py`, kiểm tra chủ sở hữu nằm trong `ownership.py`; ghi lịch sử và thực thi dời lịch nằm trong `modules/rescheduling/service.py`.

## Hoàn tác và cập nhật giao diện

Toast gắn với thế hệ thao tác hiện tại. Phản hồi thành công/lỗi của undo cũ không được xóa toast mới, đổi lỗi hay khóa nút của thao tác mới. Bộ đếm 6 giây cũng kiểm tra thế hệ. Hộp chi tiết bỏ qua phiên bản hoàn tác cũ hơn phiên bản nó đang hiển thị.

Sự kiện thường chỉ báo làm mới Calendar; Notes có lịch báo cả Notes và Calendar; Task báo Tasks/Calendar/Thông báo. Trường hợp Notes và sự kiện thường không bị gom chung phạm vi tải lại.

## PostgreSQL và Notes

`pg_notify` giữ một payload riêng cho mỗi tài khoản nhưng phát tối đa 200 payload trong một câu SQL, trong transaction hiện có. Không thay đổi cách xác định người nhận và kiểm tra phạm vi chia sẻ. Kiểm thử với 401 người nhận: đủ 401 thông báo sau commit, chỉ 3 câu SQL NOTIFY.

Widget Notes từ 6 xuống 3 truy vấn: một truy vấn đếm tổng/nhóm, một truy vấn chọn ID giới hạn trước rồi JOIN lấy preview, một truy vấn lịch hẹn theo nhóm ID. Giữ giới hạn 6 ghim + 6 chưa ghim và thứ tự cũ. Preview vẫn cắt trong SQL, không tải toàn bộ nội dung.

Đo trên TEMP table 20.000 ghi chú, 4.000 lịch hẹn, sau 2 lượt làm nóng và 10 lượt đo: bản cũ trung vị 99,256 ms, bản mới 78,407 ms. Danh sách, thứ tự, preview và lịch hẹn giống nhau. Lần gộp đầu tính preview trước khi giới hạn bị chậm hơn và đã được thay bằng phương án chọn ID trước. Đây là số đo trên máy kiểm thử, không phải cam kết tải production.

## Lưu giữ dữ liệu

| Biến cấu hình | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `MAINTENANCE_ENABLED` | `true` | Bật worker dọn dữ liệu |
| `MAINTENANCE_INTERVAL_SECONDS` | `600` | Khoảng cách giữa các đợt, tối thiểu 60 giây |
| `MAINTENANCE_BATCH_SIZE` | `500` | Tối đa số dòng mỗi bảng mỗi đợt, tối đa 5.000 |
| `SCHEDULE_HISTORY_RETENTION_DAYS` | `365` | Giữ lịch sử đổi lịch; `0` để không tự dọn bảng này |
| `PROCESSED_JOB_RETENTION_DAYS` | `30` | Giữ job đã xử lý; `0` để không tự dọn bảng này |

Cấu hình Docker đọc các biến này từ môi trường/`.env`. `maintenance_runs` điều phối bằng UPSERT nguyên tử để nhiều worker không cùng nhận một đợt. Mỗi lần dọn giới hạn theo lô; PostgreSQL bỏ qua dòng đang khóa. Job chưa xử lý, hộp thư thông báo và các receipt tạo Task/Event/Notes không bị xóa.

Migration `maintenance_001_retention_receipts` tạo `schedule_change_receipts`, backfill tất cả mã yêu cầu đã có trước khi bật dọn. Receipt tối thiểu được giữ theo tài khoản ngay cả khi lịch sử chi tiết bị dọn; gửi lại mã cũ trả 410, không làm thay đổi lịch lần nữa. Không tự dọn receipt này khi chưa có quy tắc hết hạn mã yêu cầu khác. Xóa tài khoản vẫn xóa receipt qua khóa ngoại.

Hai chỉ mục cho điều kiện dọn theo thời gian được tạo bằng migration. Đo kế hoạch chọn lô trên TEMP table 20.000 dòng, 100 dòng cũ: dùng chỉ mục, thời gian từ 3,110 ms xuống 0,238 ms trên máy kiểm thử. Kiểm thử nhiều worker xác nhận chỉ một đợt được nhận và mỗi bảng không vượt giới hạn lô.

## Mã và tài nguyên

- Dọn import Python không dùng, giữ các import đăng ký metadata và migration cần thiết.
- Bỏ CSS `.modal-overlay` không còn dùng.
- Bỏ dependency Python Redis, service và container Redis không dùng.
- Bỏ các file icon trùng trong `public`; plugin `tooling/legacyAssets.ts` phục vụ URL cũ từ `src/assets` ở dev và xuất alias khi build. `/dong-tay-land-logo.png` tiếp tục dùng nguồn `public/logo.png` của trang đăng nhập.
- Logo trên Navbar dùng PNG 128×128, giữ alpha và cùng kích thước CSS 62,4 px. Dung lượng từ 550.405 còn 13.811 byte. Bản gốc giữ cùng các logo khác tại `frontend/src/assets/logo-source.png`, không được nhập vào bundle ứng dụng.

Không xóa `workspace_versions`, `task_reminder_receipts`, cột hạn cũ hoặc các migration cũ.

## Kiểm tra

- `tests/integration/test_schedule_history_and_retention.py`: sửa trực tiếp, không ghi trùng, migration, giới hạn lô, giữ job đang chờ, chặn replay sau khi dọn.
- `tests/postgres/maintenance_realtime_check.py`: schema UUID riêng, NOTIFY theo lô và tranh chấp worker dọn dữ liệu.
- `tests/postgres/retention_plan_check.py`: đo chỉ mục trên TEMP table, tự rollback.
- `tests/postgres/notes_collection_benchmark.py`: so sánh bản trước/sau lấy từ `/tmp/notes_collection_before.py` và `/tmp/notes_collection_after.py` trong môi trường kiểm thử, không sửa dữ liệu thật.
- `frontend/tests/browser/undo-race-browser.cjs`: cổng đồng bộ giữ phản hồi undo cũ; kiểm tra cả thành công/lỗi với toast mới.
- `frontend/tests/unit/reschedule-invalidation.test.cjs`: phạm vi cập nhật đúng loại.
