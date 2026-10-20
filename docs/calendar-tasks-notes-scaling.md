# Mở rộng dữ liệu Lịch, Công việc và Ghi chú

Tài liệu này mô tả các thay đổi phân trang, kiểm tra phiên bản và phục hồi kết nối. Nhắc hạn hiện chạy ở máy chủ trong mô-đun [Thông báo](notifications.md); API nhắc hạn cũ được giữ để tương thích.

## Ranh giới giao dịch

Mọi chỗ dùng dependency `get_db` chung trong API đều dùng phạm vi hàm của FastAPI, yêu cầu tối thiểu FastAPI 0.121. Hoàn tất commit và chuẩn bị NOTIFY trong giao dịch trước khi gửi phản hồi HTTP thành công. Nếu commit lỗi, trả lỗi thay vì báo thành công rồi mới hoàn tác. Dependency xác thực và endpoint dùng cùng phạm vi để chia sẻ một phiên cơ sở dữ liệu; kết nối SSE giải phóng phiên đó trước khi bắt đầu truyền dữ liệu. Các dependency xác thực, Workspace và liên kết cũng dùng cùng quy tắc.

## Kiểm tra phiên bản khi sửa và phục hồi thời gian thực

Task PATCH yêu cầu `expected_version` cho mọi trường. Mỗi lần sửa thành công tăng `version`; đổi hạn tăng thêm `deadline_version`, dùng để phân biệt các thế hệ nhắc hạn. Trình sửa giữ phiên bản lúc mở. Đánh dấu hoàn thành và lưu biểu mẫu gửi phiên bản của mục đã dùng để thao tác. Ghi bằng phiên bản cũ trả 409, không tự lấy phiên bản mới rồi ghi lại.

Calendar PUT yêu cầu `expected_updated_at` của sự kiện lúc mở biểu mẫu. Sửa ngày giờ trong biểu mẫu dùng cùng kiểm tra dấu thời gian. Nội dung đang nhập được giữ khi có 409. Ghi chú giữ quy tắc phiên bản hiện có.

Mỗi lần SSE kết nối ban đầu/kết nối lại và bộ lắng nghe PostgreSQL nối lại đều yêu cầu làm mới `tasks`, `calendar`, `notes`, `notifications`. Gói bình luận duy trì kết nối không yêu cầu trình duyệt truy vấn nhắc hạn. Trình duyệt nối lại khi có mạng, tăng dần thời gian chờ có độ lệch ngẫu nhiên và thay kết nối không nhận gói nào trong 45 giây. Gộp thay đổi cục bộ và thông điệp SSE trong 80 ms trước khi đọc Tasks/Calendar/Notes. Khi nối lại, đọc trạng thái đã commit, không phát lại thao tác ghi hay coi NOTIFY là hàng đợi bền vững.

## Công việc và nhắc hạn

GET `/api/tasks/collection` trả một trang công việc được lọc/sắp xếp bằng SQL, mặc định API 25, tối đa 100; widget dùng 8, trang đầy đủ dùng 25; kèm số đếm tổng và nhóm quá hạn phân trang độc lập 25 mục. Bộ lọc hỗ trợ `ALL`, `PENDING`, `DONE`, `OVERDUE`. Số đếm áp dụng cho toàn bộ dữ liệu thuộc người dùng. Tiện ích và nhóm quá hạn có điều hướng trang. [Trang công việc đầy đủ](task-pagination.md) có tìm kiếm không dấu phía server; số đếm tổng và dữ liệu Lịch độc lập với tìm kiếm.

GET `/api/tasks/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` lấy công việc có hạn trong khoảng ngày nửa mở, tối đa 93 ngày. Khi lịch tháng nhỏ được chuyển xa khoảng xem chính, gửi truy vấn khoảng ngày riêng thay vì nới truy vấn chính vượt giới hạn. Hạn trên lịch không phụ thuộc trang/bộ lọc To-Do. Sự kiện và công việc là hai loại tài nguyên độc lập. Giao diện hiện dùng `/api/tasks/calendar/page` có trần dữ liệu; API cũ vẫn tương thích.

GET `/api/tasks/reminders/schedule` cũ ghép bản ghi nhắc đúng phiên bản trong một truy vấn, trả các mục, `server_now`, `next_check_at`. Mốc này là thời điểm gần nhất của giai đoạn nhắc mới, hạn, hết giờ nhắc lại hoặc nửa đêm Việt Nam. Giao diện hiện không dùng bộ hẹn giờ nhắc hạn này: hàng đợi `notification_jobs` và worker máy chủ đảm nhiệm việc gửi. Đồng hồ giao diện công việc cập nhật theo phút, khớp độ chính xác trường nhập, thay vì sắp xếp và dựng lại toàn bộ mỗi giây.

GET `/api/tasks` và `/api/notes` cũ hỗ trợ `offset`/`limit`, mặc định 100, tối đa 200, không trả toàn bộ dữ liệu không giới hạn. GET `/api/tasks/{id}` mở công việc từ thông báo kể cả khi mục nằm ngoài trang hiện tại.

## Phân trang ghi chú bằng SQL

Ghi chú được ghim trước, trong mỗi nhóm theo ngày tạo mới nhất rồi ID. Widget lấy tối đa 6 ghim và 6 chưa ghim; trang đầy đủ có tìm kiếm phía server và phân trang. Không còn thứ tự kéo thả, API dời thẻ hay bảng bố cục. Chi tiết dọn dữ liệu: [Gỡ kéo thả](remove-drag-and-drop.md).

Nâng cấp PostgreSQL cài `pg_trgm`, tạo chỉ mục GIN cho `notes.search_text`. Chuẩn hóa chữ/dấu và quy tắc tìm chuỗi con có xử lý ký tự đặc biệt được giữ nguyên. Tài khoản chạy nâng cấp cần quyền cài phần mở rộng, hoặc quản trị viên cài trước. Từ khóa ngắn vẫn có thể quét dữ liệu người dùng; phân trang bằng độ lệch và số đếm tổng còn tốn công theo độ sâu/kích thước. Đây là cải thiện giới hạn dữ liệu trả về, không phải cam kết tải 1.000 người dùng đồng thời.

## Xác minh

Máy chủ: từ `backend`, chạy `.\.venv\Scripts\python.exe -m unittest discover -s tests -q`.

Trình duyệt: chạy `node tests/browser/collection-scaling-browser.cjs`, `node tests/browser/notes-collection-browser.cjs` trong `frontend/tests/browser`. Dùng tài khoản tạm cô lập. Kiểm tra xung đột phiên bản, nối lại khi đang sửa, không truy vấn nhắc ở gói duy trì kết nối, phân trang công việc độc lập với hạn trên lịch.

Trần dữ liệu lịch, tạo/xóa có kiểm tra, phân trang công việc theo khóa, đối soát khi hết thời gian và quy trình đo 300 tài khoản/200 phiên được ghi ở [collections-capacity-300.md](collections-capacity-300.md).
