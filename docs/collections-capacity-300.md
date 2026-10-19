# Công việc, Lịch và Ghi chú: 300 tài khoản, 200 phiên hoạt động

Tài liệu ghi lại đợt tối ưu và đo tải ngày 16/10/2026 trước khi bổ sung Thông báo. Quy trình đo hiện có thêm dữ liệu và truy vấn Thông báo; xem [notifications.md](notifications.md) để biết kết quả mới hơn. Các số liệu cũ dưới đây được giữ để đối chiếu, không thay cho phép đo trên môi trường triển khai thực tế.

## Độ tin cậy khi ghi

POST tạo công việc/sự kiện nhận UUID `client_request_id` tùy chọn. Giao diện luôn gửi mã này và giữ nội dung yêu cầu ban đầu khi thử lại. Máy khách cũ không gửi mã vẫn có nguy cơ tạo trùng như trước. Hàm chung `modules/creation.py` lưu bản ghi giao nhận trong `collection_create_requests` theo khóa `(user_id, kind, request_id)`, kèm dấu vân tay nội dung. Khóa người dùng tuần tự hóa các lần tạo đồng thời. Thử lại trả tài nguyên đã tạo; nội dung khác trả 409; thử lại sau khi tài nguyên bị xóa trả 410, không tạo lại. Bản ghi giao nhận tồn tại lâu hơn tài nguyên; xóa người dùng sẽ xóa các bản ghi này.

Máy khách dùng tiện ích chung giới hạn thời gian và đối soát. Thao tác ghi hết giờ sau 15 giây; khi không có mạng, báo ngay. Mất phản hồi tạo thì thử lại một lần với cùng UUID và nội dung ban đầu. Nếu người dùng đã sửa nội dung trong lúc chờ, khôi phục kết quả tạo trước rồi mới sửa có kiểm tra phiên bản; không âm thầm ghi đè tài nguyên đã được thay đổi ở nơi khác. Đối soát sửa, co giãn hoặc đổi hạn chỉ đọc đúng bản ghi bị tác động, giới hạn 5 giây, rồi so phiên bản và trường định ghi. Nếu kiểm tra thất bại, báo chưa rõ kết quả; không khẳng định đã hoàn tác. Đối soát xóa coi GET 404 là thành công; GET 200 chưa đủ kết luận vì DELETE ban đầu có thể vẫn đang chạy. Không tự gửi lại DELETE. Đối soát liên kết chỉ đọc các cặp ghi chú/sự kiện được yêu cầu hoặc nội dung xem trước có giới hạn của sự kiện, không tải toàn bộ danh sách.

DELETE công việc yêu cầu `expected_version`; DELETE sự kiện yêu cầu `expected_updated_at` có múi giờ. Phiên bản cũ trả 409 cùng bản hiện tại thuộc người dùng. Giao diện yêu cầu xác nhận thêm bằng phiên bản mới. Tài nguyên đã xóa, trả 404, được coi là xóa thành công. Biểu mẫu vẫn cho đóng khi đang ghi/đối soát; đóng không hủy giao dịch đã chạy trên máy chủ. Không bổ sung lưu bản nháp bền vững.

DELETE ghi chú cũng yêu cầu `expected_version` trong JSON, lấy từ phản hồi thông tin xác nhận xóa. Xung đột làm mới thông tin và yêu cầu bấm lại, không âm thầm thử xóa lại. Giữ giới hạn thời gian, đối soát và quy tắc hộp xác nhận lồng nhau của Ghi chú.

## Giới hạn dữ liệu đọc và thứ tự

- Lưới lịch dùng `/api/calendar/events/collection` và `/api/tasks/calendar/page`, mỗi loại tối đa 500 mục, trả `total` chính xác và `truncated`. Giao diện cảnh báo khi dữ liệu chưa đủ. Chỉ lấy mô tả khi mở chi tiết/trình sửa. API danh sách cũ vẫn tương thích nhưng cũng giới hạn 500.
- `/api/calendar/days` tổng hợp số sự kiện/công việc và dấu cần chú ý theo ngày Việt Nam bằng hai câu SQL, tối đa 93 ngày. Chấm lịch tháng nhỏ và tiện ích dùng số này độc lập với dữ liệu lưới bị cắt. Sự kiện nhiều ngày được tính ở mọi ngày giao nhau theo khoảng thời gian có biên cuối không bao gồm.
- Tiện ích Ghi chú đọc tối đa sáu ghi chú ghim và sáu ghi chú thường, giữ nguyên các ghim đã lưu. `pinned_total` và liên kết xem toàn bộ ghim cho thấy phần còn lại. Trang đầy đủ vẫn phân trang bằng SQL.
- Công việc trả `next_cursor`, `overdue_next_cursor`. Giao diện giữ mốc của các trang trước và dùng điều kiện phân trang theo khóa khớp thứ tự: hoàn thành, ngày/giờ hạn thực tế, ưu tiên, thứ tự hiển thị, ID. Ngày NULL và các mốc nửa đêm giữ đúng quy tắc. Mốc đã sửa/xóa bị từ chối với 409 và trở về trang đầu. `offset` vẫn dùng cho tương thích/đi thẳng đến trang. Số đếm tổng chính xác vẫn đọc bằng SQL có chỉ mục, không dùng bộ nhớ đệm số đếm có thể cũ.
- Bản nâng cấp `collections_002_reliability_sorted_tasks` thêm `ix_tasks_owner_sorted` khớp toàn bộ thứ tự trên. Giữ các chỉ mục khoảng ngày/số đếm vì phục vụ điều kiện khác. Đo kế hoạch truy vấn trước khi thêm chỉ mục.
- Dời ghi chú ưu tiên vị trí nguyên còn trống giữa hàng xóm hoặc ở biên nhóm, chỉ ghi một hàng. Khi vị trí dày, một UPDATE theo tập hợp dịch khoảng bị ảnh hưởng và tái dùng chỗ cũ. Không dùng số thực nên không có sai số hay cạn khoảng trống cần dọn thủ công định kỳ. Giữ hành vi với mục ẩn/lưu trữ, biên nhóm, quyền sở hữu, kiểm tra phiên bản và dấu thời gian. Trường hợp dày nhất vẫn tốn công theo độ dài khoảng phải dịch.
- Tìm ghi chú/sự kiện yêu cầu ít nhất hai ký tự sau chuẩn hóa khi từ khóa không rỗng. Giao diện không gửi tìm một ký tự; gọi API trực tiếp với một ký tự trả rỗng. Từ khóa rỗng vẫn lấy danh sách ban đầu/gần đây. Chỉ mục trigram, LIMIT và thời gian chờ câu lệnh giới hạn chi phí còn lại; hai ký tự vẫn có thể quét dữ liệu thuộc người dùng.

## Nối lại và ngân sách kết nối cơ sở dữ liệu

SSE trên trình duyệt thử nối lại với thời gian chờ tăng dần và độ lệch ngẫu nhiên, tối đa khoảng 30,5 giây; đặt lại sau khi kết nối ổn định. Làm mới toàn bộ sau nối lại và kiểm tra khi có mạng được giãn trong hai giây. Thay đổi thời gian thực thông thường vẫn xử lý ngay. Khi quay lại thẻ trình duyệt, tải ngầm và giữ nguyên các dòng To-Do đang hiển thị.

Trong giai đoạn nhắc hạn cũ, lịch kiểm tra có độ lệch ngẫu nhiên tối đa 1,5 giây, lỗi thì thử lại sau 30–35 giây. Hiện việc gửi nhắc chạy bằng hàng đợi máy chủ, xem [Thông báo](notifications.md); trình duyệt không còn dùng vòng kiểm tra nhắc hạn cũ.

Bộ lắng nghe PostgreSQL nối lại bằng thời gian chờ tăng dần có độ lệch ngẫu nhiên, giới hạn kết nối 5 giây. SSE xác thực khi mở kết nối; gói bình luận duy trì mỗi 15 giây không truy vấn PostgreSQL hay tải lại danh sách. Luồng SSE đang mở không giữ kết nối trong nhóm kết nối truy vấn.

Mặc định PostgreSQL cho mỗi tiến trình máy chủ:

| Cấu hình | Giá trị |
|---|---:|
| `DB_POOL_SIZE` | 8 |
| `DB_MAX_OVERFLOW` | 4 |
| `DB_POOL_TIMEOUT` | 5 giây |
| `DB_STATEMENT_TIMEOUT_MS` | 8.000 |
| `DB_LOCK_TIMEOUT_MS` | 3.000 |
| Thời gian chờ giao dịch không hoạt động | 15 giây |

Mỗi tiến trình tối đa 12 kết nối trong nhóm và một kết nối LISTEN riêng. Hai tiến trình tính 26, bốn tiến trình tính 52, chưa kể nâng cấp, quản trị và ứng dụng khác. Kiểm tra `max_connections` thực tế và chừa dự phòng trước khi tăng số tiến trình. Hết kết nối, câu lệnh hết giờ hoặc chờ khóa quá lâu sẽ hoàn tác rồi trả 503 để thử lại. Đây là ngân sách kết nối, không phải bảo đảm về CPU/bộ nhớ. Docker hiện giữ một tiến trình máy chủ.

## Quy trình kiểm tra có thể chạy lại

`frontend/tests/load/collections-load.cjs` tạo 300 tài khoản tạm, 40.000 công việc, 16.000 ghi chú và 3.000 sự kiện; giữ 200 SSE và chạy 200 máy khách API trong 20 giây có thời gian nghỉ, gồm thao tác ghi có kiểm tra phiên bản. Bản hiện tại thêm 15.000 thông báo và các job nhắc hạn của tài khoản kiểm thử. Kịch bản cũng lấy EXPLAIN ANALYZE/BUFFERS cho trang đầu, trang sâu, trang theo khóa của tài khoản lớn và đo lần dời ghi chú xa. Chỉ dọn đúng UUID/tên tài khoản tạm; báo cáo không chứa token và được Git bỏ qua tại `.audit-backups/notifications-load-300-200.json`. Báo cáo của đợt cũ từng lưu ở `.audit-backups/collections-load-300-200.json`.

Chạy các bộ trình duyệt tuần tự, khi mã nguồn không đang thay đổi:

```text
cd frontend
node tests/integration/collections-request-concurrency.cjs
node tests/browser/collections-recovery-browser.cjs
node tests/browser/tasks-background-refresh-browser.cjs
node tests/browser/collection-scaling-browser.cjs
node tests/browser/notes-collection-browser.cjs
node tests/load/collections-load.cjs
```

Đây là kiểm tra nhanh API/SSE ở máy cục bộ, không phải 200 trình duyệt cùng dựng giao diện, kiểm tra tải kéo dài hoặc đo qua mạng/máy chủ chuyển tiếp của môi trường vận hành. Cách phục vụ giao diện, khóa bí mật, sao lưu và tăng cường bảo mật toàn hệ thống thuộc công việc triển khai riêng.

## Kết quả đo tại máy cục bộ ngày 16/10/2026, trước khi thêm Thông báo

Đợt đo cuối của giai đoạn này: 300 tài khoản cô lập, 200 SSE mở trong 1,19 giây, 2.335 yêu cầu API gồm 400 lần ghi có kiểm tra phiên bản trong giai đoạn hoạt động 20 giây, không có yêu cầu lỗi. p50 là 275 ms, p95 là 1.527 ms, cao nhất 2.531 ms. Dùng một tiến trình Uvicorn và nhóm kết nối 8+4; HTTP gọi trực tiếp máy chủ. Mỗi máy khách nghỉ 0,8–2 giây giữa thao tác, không dựng giao diện hay tự tải mọi vùng khi có SSE.

Với tài khoản lớn gồm 10.100 công việc và 10.020 ghi chú, EXPLAIN ghi nhận 0,089 ms cho trang công việc đầu, 49,503 ms cho trang sâu dùng độ lệch cũ và 4,391 ms cho trang theo khóa. Dời ghi chú thường từ xa lên đầu nhóm hoàn tất commit trong 30,8 ms; cách dịch khoảng trước đó mất khoảng 565–752 ms ở các lần đo trước. Điều kiện bộ nhớ đệm/tải có thể khác, nên đây là bằng chứng cho lựa chọn thay đổi, không phải cam kết tốc độ cố định. Dời vào vùng thứ tự dày vẫn có thể cần dịch nhiều hàng.

Ở giai đoạn này, 64 kiểm thử máy chủ đều qua. Kiểm tra trình duyệt qua các luồng mất phản hồi, xóa có phiên bản kể cả Ghi chú, phân trang/tìm kiếm/nối lại, tải ngầm To-Do, xác nhận/lỗi Ghi chú, kéo tiện ích và dời/co giãn sự kiện. TypeScript và bản dựng Vite đều qua. Cơ sở dữ liệu được sao lưu trước thay đổi; bản nâng cấp/chỉ mục đã áp dụng và Docker máy chủ được dựng lại. Dữ liệu tải tạm đã dọn sau kiểm thử. Các đợt kiểm tra mới hơn có số lượng test khác, xem tài liệu chức năng tương ứng.
