# Dùng chung hộp thông báo với ba ứng dụng doanh nghiệp

Platform giữ hộp thông báo duy nhất cho mỗi tài khoản. Booking Reports (`bookingreports`), Workflows (`workflows`) và Asset Manager (`itam`) đọc và cập nhật trạng thái trên cùng dữ liệu, không tạo bảng thông báo bản sao.

## Luồng kết nối

1. Người dùng vào ứng dụng con bằng SSO Platform.
2. Trong callback SSO, **backend ứng dụng con** dùng ticket còn hạn và chữ ký riêng của ứng dụng để đổi lấy token thông báo.
3. Giữ token trong phiên backend của chính người dùng. Frontend gọi backend của ứng dụng đang mở; backend gọi Platform và chuyển kết quả về.
4. Đọc/ẩn tại bất kỳ website nào cập nhật cùng hộp thư. Website Platform đang mở nhận cập nhật qua SSE hiện có.

Không đưa khóa HMAC hoặc token vào frontend, URL hay log. Không nhận `user_id` tùy ý từ trình duyệt để chọn hộp thư. Không chia sẻ token giữa người dùng hoặc dùng token đăng nhập Platform thay thế.

Token thông báo không truy cập được Tasks, Notes, Lịch, Quản trị, cài đặt thông báo hay thao tác hoãn nhắc. Mỗi yêu cầu kiểm tra lại tài khoản hoạt động và quyền vào ứng dụng nguồn. Đổi khóa ứng dụng vô hiệu hóa token của ứng dụng đó; đổi khóa ký Platform vô hiệu hóa tất cả token tích hợp.

## Cấu hình

Đã khai báo trong `.env.example` và `docker-compose.yml`:

```dotenv
NOTIFICATIONS_API_SIGNING_SECRET=
NOTIFICATIONS_BOOKINGREPORTS_API_SECRET=
NOTIFICATIONS_WORKFLOWS_API_SECRET=
NOTIFICATIONS_ITAM_API_SECRET=
NOTIFICATIONS_API_TOKEN_SECONDS=900
NOTIFICATIONS_API_SESSION_SECONDS=28800
```

Mỗi khóa là một giá trị ngẫu nhiên riêng, tối thiểu 32 ký tự. `SIGNING` chỉ đặt tại Platform; mỗi backend ứng dụng nhận đúng `API_SECRET` của mình. Không dùng lại khóa nhận thông báo `NOTIFICATIONS_*_SECRET`, khóa JWT hay SSO. Khóa rỗng tắt kết nối tương ứng và trả `503`. Tạo lại backend sau khi cấu hình.

Sinh riêng từng khóa: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

Dùng HTTPS, giới hạn lưu lượng tại reverse proxy và timeout các cuộc gọi. Mô hình backend gọi backend không cần mở CORS cho frontend ứng dụng con.

## Đổi SSO và gia hạn token

`POST /api/integrations/{source}/notification-token`

Lần đầu gửi `{"sso_ticket":"ticket-từ-callback-SSO"}`. Ticket phải còn hạn, đúng ứng dụng, khớp ID và username của tài khoản Platform đang hoạt động và được phép vào ứng dụng đó.

Gia hạn gửi `{"access_token":"token-thông-báo-của-phiên"}` tới cùng endpoint. Chỉ nhận một trong hai trường. Gia hạn giữ nguyên người dùng, ứng dụng, phạm vi và hạn phiên ban đầu; không kéo dài phiên vô hạn. Gộp các cuộc gọi gia hạn đồng thời của cùng phiên. Backend có thể gia hạn khi token 15 phút vừa hết hạn nhưng phiên 8 giờ vẫn còn, vì yêu cầu này bắt buộc có chữ ký máy chủ. Token hết hạn vẫn không đọc được hộp thư trực tiếp. Phiên hết hạn phải bắt đầu lại SSO.

Headers:

- `Content-Type: application/json`
- `X-Notification-Timestamp`: Unix timestamp số nguyên giây.
- `X-Notification-Signature`: `sha256=` cộng HMAC-SHA256 dạng hex chữ thường.

Chuỗi ký UTF-8: `timestamp + "\n" + source + "\nnotification-token\n" + raw_body`. Ký đúng byte JSON sẽ gửi, không serialize lại sau khi ký. Chấp nhận lệch timestamp tối đa 5 phút, body tối đa 16 KiB.

Ví dụ Node.js ở **backend ứng dụng con**, dùng `fetch` sẵn có:

```js
import { createHmac } from 'node:crypto';

async function exchangeNotificationToken(platformUrl, source, apiSecret, credential) {
  const body = JSON.stringify(credential);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', apiSecret)
    .update(`${timestamp}\n${source}\nnotification-token\n${body}`)
    .digest('hex');
  const response = await fetch(`${platformUrl}/api/integrations/${source}/notification-token`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      'X-Notification-Timestamp': timestamp,
      'X-Notification-Signature': `sha256=${signature}`,
    },
    body,
  });
  if (!response.ok) throw new Error(`Không cấp được token: ${response.status}`);
  return response.json();
}

// Gọi sau khi xác thực callback SSO của người dùng hiện tại.
const credentials = await exchangeNotificationToken(platformUrl, 'workflows', apiSecret, { sso_ticket: ticket });
// Lưu trong phiên backend, không trả token cho trình duyệt.
```

Phản hồi `200`, kèm `Cache-Control: no-store`:

```json
{
  "access_token": "token-chỉ-dùng-cho-thông-báo",
  "token_type": "Bearer",
  "expires_in": 900,
  "session_expires_at": "2026-10-21T17:00:00Z",
  "scope": "notifications:read notifications:write"
}
```

Token có audience riêng `dtl-notifications`. Phiên mặc định 8 giờ là giới hạn trên của tích hợp, không tự kế thừa cơ chế thu hồi phiên của ứng dụng con. Khi đăng xuất ứng dụng con phải xóa token khỏi phiên backend. Token bị lộ vẫn có thể dùng đến khi hết hạn, tài khoản bị khóa, quyền bị thu hồi hoặc khóa thay đổi; chưa có danh sách thu hồi từng token.

## API hộp thông báo chung

Backend ứng dụng con gửi `Authorization: Bearer <access_token>`. Token đăng nhập cũ của website Platform vẫn dùng các API này như trước.

| API | Chức năng |
| --- | --- |
| `GET /api/notifications?limit=25&filter=all` | Danh sách tài khoản hiện tại |
| `GET /api/notifications?before=...&limit=25` | Trang tiếp theo theo `next_cursor` |
| `GET /api/notifications?source=workflows&filter=unread` | Lọc nguồn và trạng thái |
| `GET /api/notifications/summary` | Số chưa đọc toàn hộp thư và tối đa 4 bản xem trước |
| `PATCH /api/notifications/{id}` | `{"read":true}` hoặc `{"dismissed":true}`; dùng `false` để bỏ trạng thái |
| `POST /api/notifications/read-all` | `{"through":"server_now-từ-danh-sách"}`; chỉ đọc những thông báo có trước mốc |
| `GET /api/notifications/{id}/destination` | Kiểm tra quyền và lấy tài nguyên/ứng dụng đích |

`limit`: 1–50, mặc định 25. `filter`: `all`, `unread`, `hidden`. `source`: `platform`, `bookingreports`, `workflows`, `itam`; bỏ trống để lấy toàn hộp thư của người dùng. Lịch sử thông báo nguồn đã bị thu hồi quyền vẫn có thể nằm trong hộp thư của chính tài khoản; mở đích kiểm tra lại quyền. Không có tham số chọn hộp thư người khác.

Phản hồi danh sách:

```json
{
  "items": [{
    "id": "uuid",
    "source": "workflows",
    "kind": "external.approval",
    "title": "Hồ sơ đã được duyệt",
    "body": "Hồ sơ HS-1024 đã được phê duyệt.",
    "resource_type": "workflows.record",
    "resource_id": "HS-1024",
    "due_at": null,
    "occurred_at": "2026-10-21T09:00:00Z",
    "created_at": "2026-10-21T09:00:01Z",
    "read_at": null,
    "dismissed_at": null,
    "snoozed_until": null,
    "state": "active"
  }],
  "has_more": true,
  "next_cursor": "mốc-opaque-do-server-trả",
  "server_now": "2026-10-21T09:01:00Z"
}
```

Giữ nguyên cursor, không tự dựng mốc phân trang. Không tải hết lịch sử để dựng chuông; danh sách có số truy vấn cố định, không tăng theo số dòng. Giờ API là UTC; giao diện có thể hiển thị theo giờ Việt Nam. Render nội dung dạng text, không chèn HTML.

Đích trả `{task_id}`, `{calendar_owner_id}` hoặc `{target_app, action_path}`. Mục Platform nên mở website Platform; token này không tải được chi tiết Task/Lịch. Mở ứng dụng khác qua SSO và quyền ở ứng dụng đích. Đường dẫn sâu sau SSO còn cần code tương ứng tại ứng dụng con; module này không tự triển khai phần đó.

## Cập nhật chuông và xử lý lỗi

Phiên bản này cung cấp API HTTP; token giới hạn **không** dùng cho SSE tổng `/api/realtime`. Ba ứng dụng có thể lấy summary mỗi 30–60 giây khi tab hiển thị, có jitter và giãn thời gian chờ khi lỗi. Dừng kiểm tra khi tab ẩn; tải lại khi mở chuông/quay về tab; chỉ tải danh sách khi cần. Gộp request trong cùng ứng dụng. Không dùng token Platform để thay thế khi SSE từ chối.

| Mã | Ý nghĩa |
| --- | --- |
| `401` | Chữ ký/ticket/token sai, hết hạn, đổi khóa hoặc tài khoản khóa |
| `403` | Thu hồi quyền vào ứng dụng hoặc thao tác ngoài scope |
| `404` | Thông báo không thuộc tài khoản hoặc đích không còn |
| `413` | Body quá lớn |
| `422` | Sai tham số, cursor hoặc body |
| `503` | Chưa cấu hình khóa kết nối |

Không thử lại vô hạn với lỗi xác thực. Gửi lại cùng trạng thái đọc/ẩn giữ nguyên thời điểm và không phát cập nhật dư. Khi thử lại đọc tất cả, giữ nguyên `through` để không đánh dấu các thông báo mới đến. Phản hồi hộp thư thành công có `Cache-Control: no-store`.

## Kiểm thử và phạm vi triển khai

Từ `backend`: `python -m unittest tests.integration.test_notification_api_access tests.integration.test_notifications`.

Kiểm tra ba ứng dụng, HMAC, hết hạn, gia hạn không mở rộng phiên/quyền, giới hạn token, khóa/thu hồi quyền, cô lập tài khoản, số truy vấn cố định, phân trang và trạng thái chung. Không có migration hay database mới. Module phía Platform đã sẵn sàng; cần tích hợp callback SSO, proxy backend và chuông tại ba source ứng dụng con để hiển thị tại đó.

Chạy lại 9 ca trên PostgreSQL: `docker compose exec -T -e PYTHONPATH=/app platform-backend python tests/postgres/notification_api_check.py`. Kịch bản tạo schema UUID riêng cho từng ca và tự dọn, không sửa dữ liệu người dùng.


### Nhắc hạn từ lịch được chia sẻ

Các API GET/PATCH vẫn giữ nguyên URL. Danh sách và summary tự áp dụng quyền chia sẻ lịch của tài khoản đăng nhập, gồm phạm vi Task/Notes/sự kiện và trạng thái riêng tư hiện tại. Thông báo chia sẻ mất quyền sẽ bị loại khỏi cả danh sách, nhóm đã ẩn và số chưa đọc; không giữ nội dung như lịch sử nguồn ứng dụng doanh nghiệp.

Mỗi item có thêm `calendar_owner_id` (null với mục của chính mình/nguồn doanh nghiệp) và `ownership_label` (null để không vẽ nhãn, hoặc `Của bạn`, `Của [chức danh]`; thiếu chức danh dùng họ tên). Ứng dụng con nên dùng `ownership_label` cho nguồn `platform`, không tự gán chữ Cá nhân. Summary có `has_shared_calendars` cho biết tài khoản có lịch nhận chia sẻ đang còn hiệu lực. Mở nhắc được chia sẻ trả `calendar_owner_id` từ `/destination`, để điều hướng sang lịch chỉ xem; không mở form chỉnh sửa tài nguyên của người khác.

Việc đọc/ẩn trong ba ứng dụng và Platform vẫn đồng bộ **trong cùng tài khoản**. Chủ lịch và người nhận chia sẻ có trạng thái đọc/ẩn riêng. Migration của tính năng này được ghi tại [notifications.md](notifications.md#nhắc-hạn-từ-lịch-được-chia-sẻ).
