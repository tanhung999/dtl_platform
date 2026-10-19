# Thông báo trong ứng dụng

## Phạm vi

Thông báo được mở từ biểu tượng chuông trên thanh đầu trang, có số chưa đọc và trang lịch sử; không hiển thị khung thông báo trên trang. Mỗi tài khoản có hộp riêng: tất cả, chưa đọc, đã ẩn; lọc theo nguồn, đọc/chưa đọc, ẩn/khôi phục, đánh dấu tất cả đã đọc, nhắc lại sau một giờ khi còn đủ thời gian trước hạn. Đọc hoặc ẩn không hoàn thành công việc.

Thông báo lưu ở PostgreSQL. Đóng tab hoặc tắt máy không ngừng việc tạo nhắc hạn, miễn máy chủ và cơ sở dữ liệu đang chạy. SSE chỉ báo dữ liệu thay đổi; khi kết nối lại, máy khách tải lại dữ liệu bền vững. Chưa gửi email hoặc thông báo đẩy của trình duyệt trong phạm vi này.

Nhắc trước hạn từ 08:00 ngày trước; ngày hạn từ 08:00 hoặc trước 30 phút nếu giờ hạn sớm; thêm một thông báo khi quá hạn. Công việc chỉ có ngày hết hạn lúc 00:00 ngày kế tiếp theo giờ Việt Nam. Tiến trình xử lý kiểm tra hàng đợi mỗi 15–16 giây khi rảnh, không phải bộ hẹn giờ chính xác từng giây. Nếu máy chủ ngừng lâu, khi chạy lại chỉ phát giai đoạn còn phù hợp, không phát dồn các giai đoạn đã bỏ lỡ. Lịch sử đã lưu vẫn giữ nguyên.

Công việc hoàn thành, thay hạn hoặc bị xóa làm mất hiệu lực tác vụ cũ. Thông báo đã gửi vẫn giữ nội dung lịch sử và hiển thị trạng thái mới. Xóa công việc không xóa thông báo. Không tự tạo thông báo cho mọi thao tác tự sửa ghi chú/sự kiện; thông báo mời lịch sẽ cần chức năng chia sẻ lịch riêng.

## Cấu trúc và dữ liệu

- Máy chủ: `app/modules/notifications/` gồm bộ định tuyến hộp thư, xác thực tích hợp, dịch vụ nghiệp vụ dùng chung, lập lịch và tiến trình xử lý.
- Mô hình dữ liệu: `app/db/notifications.py`; nâng cấp và điền dữ liệu cũ: `app/db/migrations/notifications.py`.
- Giao diện: `src/features/notifications/`; dùng `TasksProvider` hiện có để mở biểu mẫu công việc, không dựng biểu mẫu thứ hai.
- `notifications`: nội dung ngắn, nguồn, người nhận, trạng thái, tài nguyên đích; duy nhất `(user_id, source, event_key)`.
- `notification_jobs`: các lần nhắc bền vững, khóa chống trùng, thời điểm chạy và đã xử lý. khóa ngoại xóa tác vụ khi công việc bị xóa; tham chiếu công việc của thông báo dùng `SET NULL`.
- `notification_preferences`: bật/tắt từng nguồn, có phiên bản chống ghi đè.

Danh sách thông báo dùng mốc phân trang `(created_at, id)`, mặc định 25, tối đa 50. Không trả nội dung ghi chú/sự kiện dài. Có chỉ mục cho danh sách thông báo, chưa đọc và tác vụ chưa xử lý. Tiến trình xử lý khóa hàng `Task` trước hàng `NotificationJob`, dùng `SKIP LOCKED`, mỗi lô tối đa 100, tối đa 5 lô trước khi nhường; nhiều tiến trình xử lý không gửi trùng. Ghi thông báo, đánh dấu tác vụ, phát PG NOTIFY cùng giao dịch. Lỗi thì hoàn tác giao dịch và thử lại; không mất tác vụ khi tiến trình dừng giữa chừng. Máy khách gộp yêu cầu làm mới dữ liệu, tải ngầm, hủy phản hồi cũ, giới hạn yêu cầu trong 15 giây và không kiểm tra định kỳ hộp thư theo giây. SSE hiện dùng PostgreSQL NOTIFY như các mô-đun khác.

Hiện chưa tự xóa lịch sử và tác vụ đã xử lý, vì các bản ghi còn là khóa chống phát trùng. Nếu thêm chính sách lưu giữ sau này phải giữ sổ giao nhận chống trùng riêng; không chỉ xóa bản ghi cũ rồi cho thử lại tạo lại.

## Hợp đồng tích hợp ba ứng dụng

Đã chuẩn bị API tiếp nhận giữa các máy chủ, chưa thay đổi mã nguồn của Booking Reports, Workflows hoặc ITAM. Không có kết nối thật khi chưa cấu hình khóa và bên gửi.

`POST /api/integrations/{source}/notifications`, với `source` là `bookingreports`, `workflows`, `itam`.

Biến môi trường (mỗi nguồn một bí mật ngẫu nhiên riêng, tối thiểu 32 ký tự):

```dotenv
NOTIFICATIONS_WORKER_ENABLED=true
NOTIFICATIONS_BOOKINGREPORTS_SECRET=
NOTIFICATIONS_WORKFLOWS_SECRET=
NOTIFICATIONS_ITAM_SECRET=
```

Mặc định khóa rỗng, API nguồn đó trả 503. Không dùng lại JWT/SSO khóa bí mật; không đưa khóa vào giao diện. Sau khi đặt biến môi trường, tạo lại máy chủ để nạp cấu hình.

Nội dung yêu cầu mẫu:

```json
{
  "external_id": "approval:123:assigned:v1",
  "recipient_user_id": "UUID-TAI-KHOAN-PLATFORM",
  "title": "Có hồ sơ mới cần duyệt",
  "body": "Đề nghị mua thiết bị phòng kinh doanh",
  "kind": "approval",
  "resource_type": "approval",
  "resource_id": "123",
  "action_path": "/approvals/123",
  "occurred_at": "2026-10-16T09:00:00+07:00"
}
```

Người nhận dùng ID platform đã ánh xạ qua SSO, không tra theo tên hiển thị/email tùy ý. Người nhận phải active và có quyền vào ứng dụng nguồn. `external_id` là ID của **một lần thông báo bất biến**, không chỉ là ID hồ sơ; lần cập nhật mới dùng ID/revision mới. Cùng người nhận + nguồn + ID + nội dung trả lại cùng ID thông báo. Dùng lại ID cho nội dung khác trả 409. Khi mute nguồn, thông báo ngoài vẫn được lưu ở trạng thái đọc/ẩn để thử lại không phát lại.

Header chữ ký:

```text
X-Notification-Timestamp: <Unix seconds>
X-Notification-Signature: sha256=<HMAC-SHA256 dạng hex chữ thường>
```

Chuỗi ký là `timestamp + "\n" + source + "\n" + raw_body` (UTF-8). Máy chủ chấp nhận lệch tối đa 5 phút. Ký chính xác body gửi đi, không chuyển đổi dữ liệu trả về lại sau khi ký. Ví dụ máy chủ Node.js:

```js
import { createHmac } from 'node:crypto';
const source = 'workflows';
const body = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', process.env.PLATFORM_NOTIFICATION_SECRET)
  .update(`${timestamp}\n${source}\n${body}`, 'utf8').digest('hex');
const response = await fetch(`${platformUrl}/api/integrations/${source}/notifications`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Notification-Timestamp': timestamp,
    'X-Notification-Signature': `sha256=${signature}`,
  },
  body,
  signal: AbortSignal.timeout(10000),
});
```

Ứng dụng nguồn nên ghi hàng đợi gửi tại nguồn cùng giao dịch nghiệp vụ, rồi gửi ngoài giao dịch. Mất phản hồi thì thử lại cùng `external_id`/nội dung, tạo dấu thời gian và chữ ký mới; thời gian chờ tăng dần có độ lệch ngẫu nhiên cho lỗi mạng/429/503. 401 cần sửa khóa/đồng hồ, 403 cần kiểm tra quyền, 409 cần kiểm tra ID/nội dung, không thử lại vô hạn các lỗi đó. Giới hạn phần thân yêu cầu 16 KiB; trường `title` tối đa 255, trường `body` tối đa 1.200 ký tự. Nội dung là văn bản thuần, không hiển thị như HTML. `action_path` chỉ chấp nhận đường dẫn tương đối trong ứng dụng nguồn, chặn chuyển hướng ngoài và đường dẫn mã hóa nguy hiểm.

Hiện bấm thông báo ngoài mở ứng dụng qua SSO hiện có. `action_path` được lưu sẵn, nhưng chưa chuyển sâu tới hồ sơ vì đường dẫn nhận phản hồi của ba website chưa có hợp đồng liên kết sâu; cần bổ sung danh sách cho phép và đường dẫn trở về ở bên nhận trước. Nếu các website chỉ cung cấp API đọc, có thể thêm bộ kết nối lấy dữ liệu theo mốc phân trang và đẩy qua cùng quy tắc chống trùng; không chạy kiểm tra định kỳ từ mỗi trình duyệt. Khóa HMAC là quyền máy chủ đáng tin cậy của từng ứng dụng; triển khai qua HTTPS và giới hạn lưu lượng tại máy chủ chuyển tiếp.

## Kiểm tra

- Máy chủ: `python -m unittest discover -s tests -q`; các kiểm thử `test_notifications.py` chạy trên SQLite cô lập.
- PostgreSQL: `docker compose exec -T -e PYTHONPATH=/app platform-backend python tests/postgres/notifications_postgres_check.py`. Kịch bản tạo lược đồ UUID riêng và dọn đúng lược đồ đó; kiểm tra hoàn tác giao dịch, nhiều tiến trình xử lý và nhận cùng thông báo đồng thời. Không sửa dữ liệu người dùng.
- Trình duyệt: từ thư mục `frontend`, chạy `node tests/browser/notifications-browser.cjs`; tài khoản kiểm thử UUID tự dọn, kiểm tra thông báo lúc đóng tab, SSE, đọc/ẩn/khôi phục, phân trang, nguồn và điện thoại.
- Tải hỗn hợp: `node tests/load/collections-load.cjs`; 300 tài khoản, 200 SSE và 200 vòng yêu cầu, có Công việc, Ghi chú, Lịch và Thông báo, 15.000 thông báo và tác vụ nhắc hạn của tài khoản kiểm thử. Báo cáo cục bộ trong `.audit-backups/notifications-load-300-200.json`. Đây là bài kiểm tra nhanh API, không tương đương 200 trình duyệt cùng dựng giao diện hoặc cam kết tải môi trường vận hành dài hạn.

Đợt đo riêng ngày 16/10/2026 (không dựng bản ứng dụng giao diện đồng thời): 1.865 yêu cầu trong bài tải 20 giây, 281 lần sửa Công việc, không có yêu cầu lỗi; p50 710 ms, p95 1.893 ms, cao nhất 3.435 ms. API tóm tắt Thông báo có p95 1.821 ms; danh sách thông báo tất cả 1.766 ms, danh sách thông báo chưa đọc 1.771 ms. Số liệu gồm thời gian chờ khi cạnh tranh cùng nhóm kết nối với các mô-đun khác. Đợt chạy trùng với dựng bản ứng dụng giao diện có p95 khoảng 12,3 giây, cho thấy cần tách dựng bản ứng dụng khỏi tiến trình phục vụ người dùng và đo lại trên hạ tầng triển khai thực tế. PostgreSQL kiểm tra riêng: 80 tác vụ dùng 8 câu SQL, hoàn tác giao dịch không để lại thông báo nửa chừng, 3 tiến trình xử lý đồng thời không phát trùng và 20 yêu cầu tích hợp trùng chỉ tạo một bản.
