# Đặt lịch cho ghi chú

Ghi chú chỉ còn **Gắn vào lịch**. Đã bỏ gắn ghi chú vào sự kiện có sẵn, bộ chọn liên kết, thêm ghi chú trong biểu mẫu sự kiện, đếm ghi chú trên sự kiện và các API liên kết nhiều–nhiều.

## Cách sử dụng

Nút trong trình sửa phụ thuộc trạng thái:

| Trạng thái | Thao tác lịch |
| --- | --- |
| Ghi chú mới hoặc đã lưu nhưng chưa chọn lịch | Gắn vào lịch |
| Đã chọn lịch nháp, chưa lưu lịch hẹn | Bỏ chọn lịch; không có Dời lịch |
| Ghi chú và lịch hẹn đã lưu | Dời lịch và các trường ngày giờ; không có Gắn vào lịch hoặc Bỏ chọn lịch |
| Ghi chú đã lưu trữ | Không có thao tác gắn/dời lịch |

Tạo mới không có nút xóa/lưu trữ/dời lịch. Đóng bằng X vẫn được trong lúc chờ lưu; thao tác đã gửi có thể hoàn tất, nhưng phản hồi cũ không đóng form mở sau đó. Chuyển từ tải ghi chú cũ sang tạo mới hủy yêu cầu tải cũ. Calendar và Tasks cũng chỉ mở chi tiết từ yêu cầu mới nhất.

Trong trình sửa ghi chú, bấm **Gắn vào lịch** để mở bộ chọn ngày giờ dùng chung với To-Do. Mặc định là hôm nay theo giờ Việt Nam. Chỉ chọn ngày thì hiện ở vùng Cả ngày; có giờ thì gợi ý thời lượng 30 phút và cho sửa giờ kết thúc. Ngày kết thúc cả ngày được lưu bằng mốc 00:00 ngày kế tiếp, không bao gồm mốc này.

Bấm **Lưu ghi chú** mới tạo hoặc cập nhật lịch hẹn. Hủy bỏ bản đang nhập không tạo ghi chú/sự kiện. Mỗi ghi chú tối đa một lịch hẹn riêng, sửa ngày giờ cập nhật sự kiện đó. Nội dung vẫn ở Notes; tiêu đề lịch hẹn lấy theo ghi chú và cập nhật khi lưu ghi chú kèm lịch hẹn.

Thẻ ghi chú có lịch hẹn hiện chip lịch; ghi chú thường hiện ngày tạo. Bộ lọc **Có lịch** chỉ xuất hiện khi có ghi chú đã đặt lịch. Ghim, màu, sắp xếp, tìm kiếm phía máy chủ, phân trang và lưu trữ giữ nguyên. Xóa ghi chú xóa luôn lịch hẹn gắn kèm, toàn bộ các lần lặp và hủy nhắc nhở còn chờ; xóa riêng lịch hẹn giữ ghi chú. Lưu trữ không xóa lịch hẹn.

## Mã nguồn và dữ liệu

- `frontend/src/features/note-scheduling`: bộ chọn ngày giờ và kiểu lịch hẹn; API vẫn thuộc `features/notes/api.ts` và `features/calendar/api.ts`.
- `backend/app/modules/note_scheduling`: lưu lịch hẹn và trả thông tin hiện hành, cùng giao dịch với ghi chú.
- `note_calendar_schedules`: `note_id` là khóa chính, `event_id` duy nhất, khóa ngoại xóa dây chuyền. Không cần bảng liên kết nhiều–nhiều.
- Bản nâng cấp `notes_002_remove_event_links` xóa bảng `calendar_event_notes` và chỉ mục/cột tìm tên sự kiện dùng riêng cho bộ chọn đã bỏ. Giữ toàn bộ ghi chú, nội dung, sự kiện, lịch hẹn riêng và biên nhận yêu cầu. Hai khóa phiên bản nâng cấp cũ được giữ để tương thích database đã chạy trước đó.
- Yêu cầu tạo giữ UUID khi thử lại, không tạo trùng ghi chú/lịch hẹn. Sửa kiểm tra cả `expected_version` của ghi chú và `expected_updated_at` của lịch hẹn. Xung đột trả 409 và giữ nội dung đang nhập. Yêu cầu sửa có timeout và đối soát GET đúng ghi chú.
- Sau commit phát SSE `notes` và `calendar`. Danh sách lấy thông tin lịch hẹn cho các ghi chú trong trang bằng một truy vấn theo lô, không N+1 và không tải nội dung sự kiện/ghi chú đầy đủ.

## Kiểm tra

Từ `backend`: `python -m unittest discover -s tests -q`.

Từ `frontend`:

```sh
npm test
node tests/browser/note-scheduling-browser.cjs
node tests/browser/notes-reliability-browser.cjs
node tests/browser/notes-collection-browser.cjs
node tests/browser/notes-delete-browser.cjs
```

Kiểm thử dùng dữ liệu cô lập. Bản nâng cấp được kiểm tra chạy lặp, giữ ghi chú, màu, sự kiện và lịch hẹn. Các đường dẫn API liên kết cũ không còn hoạt động; payload tạo sự kiện chứa `note_ids`/`new_notes` bị từ chối.

## Mở ghi chú từ Lịch

Lịch trả `scheduled_note_id` từ liên kết lịch hẹn riêng trong cùng truy vấn danh sách/chi tiết, không tải nội dung note và không thêm bảng mới. Các mục này có nhãn biểu tượng **Ghi chú** (chỉ biểu tượng khi ô hẹp). Widget, Tuần, Tháng và Danh sách đều mở chung `NoteModal`, giữ màu, nội dung, ghim, lưu trữ, xác nhận xóa và bộ chọn ngày giờ của Notes. `CalendarItemModal` phân biệt loại mục; `CalendarNoteModal` chỉ tải đầy đủ đúng một ghi chú khi mở và xử lý lỗi tải bằng hộp có Đóng/Thử lại. Sự kiện thường vẫn dùng `EventModal`. Không khôi phục chức năng gắn note vào sự kiện có sẵn.

## Hiển thị nhiều ngày và phân biệt loại mục

Icon lịch của sự kiện và icon tờ giấy của ghi chú đứng trước tiêu đề, không bị co. Chip Ghi chú chỉ hiện khi đủ chỗ; ô hẹp giữ icon, tên và giờ, ẩn trạng thái dài. Ghi chú có viền trái nét đứt; màu vẫn theo trạng thái thời gian, không đổi quy ước màu.

Khoảng có giờ kéo dài nhiều ngày hiển thị theo ngày: ngày đầu Từ 09:03, ngày giữa Tiếp tục từ ngày trước, ngày cuối Đến 09:33. Không gọi đoạn giữa là Cả ngày để tránh nhầm với ghi chú không có giờ. Mốc kết thúc đúng 00:00 dùng biên 24:00 của ngày trước. Khi khối bị cắt ở đầu lưới có dấu ↑ với chú thích giờ bị ẩn. Tooltip giữ loại mục, tiêu đề và khoảng đầy đủ. Không thay đổi dữ liệu hoặc vị trí thời gian đã lưu.

Ghi chú mới chọn giờ mặc định dài 30 phút; chọn ngày không có giờ vẫn là Cả ngày. Trình sửa cảnh báo khoảng nhiều ngày là liên tục, không phải lặp mỗi ngày. Kiểm tra hiển thị: `node tests/browser/calendar-item-display-browser.cjs`.

Khối có giờ còn kéo dài qua ngày sau hiện mũi tên ↓ ở cuối khối, ở cạnh dưới khối. Ngày kết thúc không hiện mũi tên; kết thúc đúng 00:00 được tính là hết ngày trước. Áp dụng cho cả sự kiện và ghi chú trên lưới tuần.

## Bộ lọc Lịch độc lập

Sidebar có ba ô tick Sự kiện (xanh dương), Công việc (cam), Ghi chú (tím), mỗi ô có số lượng riêng và lưu trạng thái theo tài khoản trong localStorage. Sự kiện thường và lịch hẹn ghi chú được lọc riêng bằng `include_events`/`include_notes` ở API collection **trước LIMIT**; trả `event_total`/`note_total` đầy đủ kể cả khi đang ẩn. Tắt cả hai vẫn trả số đếm nhưng không có mục. Mini-calendar đếm `events` và `notes` riêng để chấm ngày khớp bộ lọc. Không phát sinh API đếm theo từng ngày hoặc từng ghi chú và không thêm chỉ mục/bảng.

Nút Lưu trữ trong trình sửa lưu cả ngày giờ đang sửa, kiểm tra biểu mẫu và phiên bản trong cùng giao dịch. Xung đột lịch hẹn không lưu nội dung hay trạng thái lưu trữ dở dang.

## Ngày giờ khi chạy server trên máy khác

Tất cả cột thời điểm trong model dùng `UTCDateTime` tại `backend/app/db/types.py`. Kiểu này tự đổi đầu vào có múi giờ sang UTC trước khi ghi và trước khi dùng làm điều kiện truy vấn; tự trả datetime UTC khi đọc, bao gồm SQLite vốn làm mất tzinfo. Giá trị mới thiếu múi giờ bị từ chối thay vì đoán theo máy chạy server. Khi thêm model hoặc cột thời điểm mới, dùng `UTCDateTime()`, không dùng trực tiếp `DateTime`; kiểm thử kiểm tra toàn bộ model đã đăng ký để ngăn bỏ sót.

Đây là thay đổi lớp chuyển đổi SQLAlchemy: PostgreSQL vẫn dùng `TIMESTAMP WITH TIME ZONE`, SQLite vẫn dùng `DATETIME`. Không cần đổi cấu trúc bảng hoặc cộng/trừ ngày cho dữ liệu hiện có. Việc đọc timestamp SQLite cũ không có múi giờ tuân theo hợp đồng dữ liệu UTC vốn có của ứng dụng; dữ liệu nhập ngoài hợp đồng này cần được xác minh riêng. `DATE` và `TIME` của hạn Tasks vẫn giữ nghĩa ngày/giờ địa phương. API ngày giờ mới vẫn phải xác thực đầu vào có múi giờ ở schema để trả lỗi 422 rõ ràng trước khi ghi database.

Sau khi cập nhật source trên máy triển khai, dựng lại backend bằng `docker compose up -d --build platform-backend`. Không cần cấu hình thêm múi giờ theo từng máy. Kiểm tra lớp dữ liệu: `python -m unittest tests.integration.test_utc_datetime -v` từ thư mục `backend`; kiểm tra PostgreSQL bằng `docker compose exec -T -e PYTHONPATH=/app platform-backend python tests/postgres/utc_datetime_check.py` từ gốc repo. Kiểm tra PostgreSQL chỉ ghi bảng tạm và rollback khi kết thúc.

Timestamp API luôn có múi giờ UTC (`Z` hoặc `+00:00`), kể cả khi SQLite trả datetime không có tzinfo. Lưới ngày và ngày tạo ghi chú hiển thị theo giờ Việt Nam, độc lập múi giờ trình duyệt. Ví dụ chọn cả ngày từ 22 đến hết 25/10/2026: lưu bắt đầu `2026-10-21T17:00:00Z`, kết thúc không bao gồm `2026-10-25T17:00:00Z` (00:00 ngày 26 ở Việt Nam). Ngày 21 trong chuỗi UTC không có nghĩa lịch bắt đầu ngày 21 tại Việt Nam.

Không bù thêm một ngày vào database. Chuẩn hóa datetime đọc từ DB trước khi serialize ở collection Calendar, chi tiết/danh sách Notes và lịch chia sẻ. Dữ liệu date-only của Tasks không qua chuyển đổi timestamp này. Kiểm thử hồi quy: `backend/tests/integration/test_calendar_timezone_contract.py`, cùng các ca frontend timezone cho ngày 22–25 và ngày tạo sát nửa đêm.

## Nhắc nhở tùy chọn

Lịch hẹn của ghi chú dùng cùng cơ chế [nhắc nhở cá nhân](notifications.md): mặc định Không nhắc, nhắc theo giờ bắt đầu hoặc ngày giờ tự chọn trước thời điểm kết thúc, kể cả khi ghi chú đã bắt đầu. Ghi chú chưa gắn vào lịch không có nhắc. Lưu trữ/xóa ghi chú hủy job chưa gửi; khôi phục chỉ lập lại lần nhắc còn ở tương lai. Đổi nội dung không tạo lượt nhắc mới.
