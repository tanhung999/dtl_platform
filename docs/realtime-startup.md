# Tải ban đầu và kết nối realtime

Mục tiêu: mở/reload trang yên thì mỗi API danh sách cần thiết chỉ tải một lượt, đồng thời phục hồi được thay đổi xảy ra trước hoặc trong lúc nối SSE.

## Luồng hoạt động

- Các GET danh sách chờ thông điệp `ready` đầu tiên tối đa 1,5 giây. Nếu SSE chưa sẵn sàng, API vẫn chạy để người dùng không phải chờ vô hạn.
- Backend đăng ký hàng nhận trước, rồi đọc phiên bản và gửi `ready`. Thay đổi commit trong khoảng này vẫn nằm trong hàng nhận.
- Bảng `workspace_versions` lưu một hàng theo người dùng, các bộ đếm theo nhóm tài nguyên. Bộ đếm tăng trong cùng transaction với thay đổi nghiệp vụ và chỉ xuất hiện sau commit.
- API danh sách trả `X-Workspace-Versions`. Trên PostgreSQL, các GET này dùng `REPEATABLE READ` để dữ liệu, số đếm và phiên bản thuộc cùng một snapshot.
- Nếu SSE nối muộn, client đối chiếu phiên bản với các GET đã chạy. Chỉ nhóm có phiên bản mới hơn mới phát yêu cầu tải bù. GET còn đang trả về cũng được đối chiếu sau khi nhận đủ dữ liệu.
- Khi reconnect, backend gửi lại vector phiên bản hiện tại. Client bỏ qua phiên bản đã nhận, không mặc định tải lại tất cả. Khi listener PostgreSQL phục hồi, các kết nối đang mở cũng đối soát lại vector này.
- Không phát lại nội dung sự kiện cũ; SSE chỉ truyền tín hiệu thay đổi và phiên bản, dữ liệu vẫn lấy qua API có kiểm tra quyền.

## Gộp request đang chạy

`SharedReads` chỉ chia sẻ GET cùng phiên đăng nhập, URL/tham số và lựa chọn request tương ứng. Không lưu kết quả sau khi hoàn tất.

- Mỗi thành phần có quyền hủy riêng. Một thành phần hủy không hủy transport khi còn thành phần khác đang chờ.
- Khi tất cả thành phần hủy, transport bị hủy và mục đang chạy được dọn. Việc cleanup/remount trong cùng một lượt của React có thể dùng lại transport.
- Request hoàn tất hoặc lỗi đều được gỡ khỏi bảng gộp.
- GET sau một thao tác ghi hoặc phiên bản realtime mới không dùng chung transport của snapshot cũ đang chạy.
- Đăng xuất/đổi phiên hủy request cũ; kết quả và thông điệp SSE về muộn của phiên cũ bị loại.
- Không ghi token hoặc nội dung API vào log; không lưu dữ liệu tài nguyên trong localStorage.

## Database và vận hành

Migration cộng thêm `realtime_001_scope_versions`; không sửa nội dung Tasks, Notes, Calendar hay quyền hiện có. Tài khoản chưa từng thay đổi có phiên bản mặc định bằng 0.

Giữ PostgreSQL NOTIFY và SSE hiện tại; không chuyển Redis trong thay đổi này. Số đếm và việc gộp truy vấn Notes là các phần tối ưu riêng.

Danh sách/tóm tắt thông báo chỉ lấy bốn cột Task cần xác định trạng thái: ID, hoàn thành, phiên bản deadline và ngày hạn. Tiêu đề/nội dung thông báo lấy từ bản đã lưu của thông báo. Các cột Task còn lại bị chặn truy vấn ngầm để tránh phát sinh N+1 khi sửa serializer sau này.

Sự kiện thông thường không phát tín hiệu Notes. Khi sửa/dời/xóa sự kiện, truy vấn lấy và khóa sự kiện đã có sẵn `scheduled_note_id` qua truy vấn con theo chỉ mục duy nhất `note_calendar_schedules.event_id`. Tận dụng kết quả này, giữ lại trước khi xóa liên kết; không chạy thêm một truy vấn `EXISTS` trùng lặp. Sự kiện có liên kết vẫn làm mới Notes khi đổi tiêu đề, thời gian, riêng tư hoặc bị xóa. Widget Notes và metadata phiên bản chỉ phụ thuộc `notes`/`layout`, không phụ thuộc mọi thay đổi Calendar.

Không có truy vấn kiểm tra phiên mỗi heartbeat. GET danh sách có thêm một truy vấn lấy phiên bản; đổi lại tránh được lượt tải API thứ hai lúc khởi tạo. Khi thực sự có thay đổi, focus hoặc thao tác người dùng thì vẫn có thể phát sinh GET mới.

## Kiểm tra

- `frontend/tests/unit/realtime-bootstrap.test.cjs`: chuyển từ snapshot sang ready, SSE muộn, phiên bản lặp, kết quả đang bay và đổi phiên.
- `frontend/tests/unit/shared-reads.test.cjs`: hủy một/tất cả thành phần, khóa khác nhau, lỗi, cleanup/remount và kết quả muộn sau đăng xuất.
- `backend/tests/integration/test_realtime_versions.py`: tăng phiên bản theo transaction, rollback, subscribe trước bước đọc ready.
- `backend/tests/postgres/realtime_versions_check.py`: schema UUID cô lập, commit/NOTIFY thật, đồng bộ bằng Event thay vì sleep để quyết định thứ tự; kiểm tra snapshot `REPEATABLE READ`.
- `frontend/tests/browser/realtime-startup-browser.cjs`: dùng bundle production và API thật, chặn SSE bằng cổng Promise để kiểm tra timeout, commit trước kết nối, tải đúng scope và reconnect. Cần build frontend trước khi chạy.

Kiểm tra bằng bundle production trên Docker cục bộ: các API danh sách của dashboard tải một lần khi reload không có thay đổi. Đây là kiểm tra tính đúng đắn và số request, không phải cam kết tải production.
