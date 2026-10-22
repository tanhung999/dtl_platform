# Thông báo trong ứng dụng

API dùng chung hộp thông báo với ba ứng dụng: xem [Hướng dẫn tích hợp](notification-api-integration.md).

## Phạm vi

Thông báo được mở từ biểu tượng chuông trên thanh đầu trang, có số chưa đọc và trang lịch sử; không hiển thị khung thông báo trên trang. Mỗi tài khoản có hộp riêng: tất cả, chưa đọc, đã ẩn; lọc theo nguồn, đọc/chưa đọc, ẩn/khôi phục, đánh dấu tất cả đã đọc, nhắc lại sau một giờ khi còn đủ thời gian trước hạn. Đọc hoặc ẩn không hoàn thành công việc.

Thông báo lưu ở PostgreSQL. Đóng tab hoặc tắt máy không ngừng việc tạo nhắc hạn, miễn máy chủ và cơ sở dữ liệu đang chạy. SSE chỉ báo dữ liệu thay đổi; khi kết nối lại, máy khách tải lại dữ liệu bền vững. Chưa gửi email hoặc thông báo đẩy của trình duyệt trong phạm vi này.

Nhắc nhở do người dùng tự chọn cho Công việc, Sự kiện và Ghi chú (kể cả chưa gắn vào lịch). Mặc định **Không nhắc**; mỗi mục có một lần nhắc: đúng giờ, trước 15 phút, 30 phút, 1 giờ, 1 ngày hoặc ngày giờ cụ thể. Công việc tính theo hạn, Sự kiện/Ghi chú tính theo giờ bắt đầu. Mục cả ngày hoặc không đặt giờ cần chọn ngày giờ nhắc cụ thể; gợi ý 09:00 theo giờ Việt Nam. Không có nhắc tự động trước một ngày, đầu ngày hay quá hạn nữa.

Nhắc theo khoảng thời gian đi theo mốc khi dời lịch. Nhắc tùy chỉnh giữ giờ đã chọn; form Dời lịch hiển thị lại cấu hình và nhắc người dùng kiểm tra. Không cho đặt mới lịch nhắc đã qua. Với mục chưa kết thúc, nhắc tùy chỉnh của Sự kiện/Ghi chú được chọn sau giờ bắt đầu nhưng phải trước giờ kết thúc; Task chưa quá hạn không được nhắc vượt hạn (hạn cả ngày tính đến cuối ngày). Mục đã qua cho đặt một nhắc tùy chỉnh mới ở tương lai mà không đổi lịch gốc. Form cảnh báo ngay và chặn lưu khi vượt giới hạn, backend kiểm tra lại. Lưu nội dung mà không đổi lịch nhắc không gửi lại và không bắt người dùng sửa một lịch nhắc đã gửi.

Hoàn thành Công việc, lưu trữ Ghi chú, gỡ/xóa Sự kiện hoặc xóa tài nguyên hủy job chưa gửi; lịch sử đã gửi vẫn giữ và hiển thị trạng thái mới. Khôi phục hoặc Hoàn tác chỉ lập lại job nếu giờ nhắc còn ở tương lai, không phát lại nhắc đã qua. Đọc/ẩn thông báo không thay đổi mục nguồn. Nút Nhắc lại sau 1 giờ cho công việc chỉ hoạt động khi lịch nhắc còn đúng phiên bản và hạn còn trên 1 giờ.

Tiến trình xử lý kiểm tra mỗi 15–16 giây khi rảnh, không đảm bảo chính xác từng giây. Nếu máy chủ ngừng, khi chạy lại sẽ ghi một thông báo cho lần nhắc do người dùng đã chọn mà chưa xử lý; có thể trễ so với giờ hẹn. Đóng website vẫn tạo thông báo trong hộp thư nếu máy chủ chạy; chưa có email hay thông báo đẩy khi đóng trình duyệt. Công tắc **Nhắc hạn từ lịch của bạn và lịch được chia sẻ** trong cài đặt tắt việc phát các nhắc đến tài khoản đang chỉnh cài đặt; những lượt bị tắt sẽ không phát dồn khi bật lại. API giữ khóa `task_reminders` để tương thích.

Migration `notifications_002_user_selected_reminders` tự chạy khi khởi động: bổ sung cấu hình và phiên bản nhắc, hỗ trợ job cho Sự kiện/Ghi chú, hủy các job tự động chưa gửi, giữ nguyên dữ liệu và lịch sử thông báo. Những mục cũ mặc định Không nhắc, không tự chọn thời gian thay người dùng. Các GET `/api/tasks/reminders` và `/api/tasks/reminders/schedule` cũ trả rỗng, không còn kiểm tra theo giai đoạn; thao tác dismiss/snooze của giai đoạn cũ trả 410. Dùng hộp thư `/api/notifications` chung.

## Cấu trúc và dữ liệu

- Máy chủ: `app/modules/notifications/` gồm bộ định tuyến hộp thư, xác thực tích hợp, dịch vụ nghiệp vụ dùng chung, lập lịch và tiến trình xử lý.
- Mô hình dữ liệu: `app/db/notifications.py`; nâng cấp và điền dữ liệu cũ: `app/db/migrations/notifications.py`.
- Giao diện: `src/features/notifications/`; dùng `TasksProvider` hiện có để mở biểu mẫu công việc, không dựng biểu mẫu thứ hai.
- `notifications`: nội dung ngắn, nguồn, người nhận, trạng thái, tài nguyên đích; duy nhất `(user_id, source, event_key)`.
- `notification_jobs`: các lần nhắc bền vững, khóa chống trùng, thời điểm chạy và đã xử lý. mỗi job gắn một trong `task_id`, `event_id`, `note_id` và `reminder_version`. Khóa ngoại xóa job khi mục nguồn bị xóa; thông báo dùng `SET NULL` để giữ lịch sử.
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

- Máy chủ: `python -m unittest discover -s tests -q`; các kiểm thử `test_notifications.py`, `test_user_reminders.py`, `test_user_reminder_migration.py` chạy trên SQLite cô lập. Kiểm tra tương tự trên PostgreSQL bằng `tests/postgres/user_reminders_check.py`.
- PostgreSQL: `docker compose exec -T -e PYTHONPATH=/app platform-backend python tests/postgres/notifications_postgres_check.py`. Kịch bản tạo lược đồ UUID riêng và dọn đúng lược đồ đó; kiểm tra hoàn tác giao dịch, nhiều tiến trình xử lý và nhận cùng thông báo đồng thời. Không sửa dữ liệu người dùng.
- Trình duyệt: từ thư mục `frontend`, chạy `node tests/browser/notifications-browser.cjs`; tài khoản kiểm thử UUID tự dọn, kiểm tra thông báo lúc đóng tab, SSE, đọc/ẩn/khôi phục, phân trang, nguồn và điện thoại.
- Tải hỗn hợp: `node tests/load/collections-load.cjs`; 300 tài khoản, 200 SSE và 200 vòng yêu cầu, có Công việc, Ghi chú, Lịch và Thông báo, 15.000 thông báo và tác vụ nhắc hạn của tài khoản kiểm thử. Báo cáo cục bộ trong `.audit-backups/notifications-load-300-200.json`. Đây là bài kiểm tra nhanh API, không tương đương 200 trình duyệt cùng dựng giao diện hoặc cam kết tải môi trường vận hành dài hạn.

Đợt đo riêng ngày 16/10/2026 (không dựng bản ứng dụng giao diện đồng thời): 1.865 yêu cầu trong bài tải 20 giây, 281 lần sửa Công việc, không có yêu cầu lỗi; p50 710 ms, p95 1.893 ms, cao nhất 3.435 ms. API tóm tắt Thông báo có p95 1.821 ms; danh sách thông báo tất cả 1.766 ms, danh sách thông báo chưa đọc 1.771 ms. Số liệu gồm thời gian chờ khi cạnh tranh cùng nhóm kết nối với các mô-đun khác. Đợt chạy trùng với dựng bản ứng dụng giao diện có p95 khoảng 12,3 giây, cho thấy cần tách dựng bản ứng dụng khỏi tiến trình phục vụ người dùng và đo lại trên hạ tầng triển khai thực tế. PostgreSQL kiểm tra riêng: 80 tác vụ dùng 8 câu SQL (đợt đo cơ chế cũ), hoàn tác giao dịch không để lại thông báo nửa chừng, 3 tiến trình xử lý đồng thời không phát trùng và 20 yêu cầu tích hợp trùng chỉ tạo một bản.

Phần chọn nhắc hạn chuyển xám khi chưa có mốc hợp lệ hoặc giờ kết thúc/hạn đã qua. Chọn mốc còn ở tương lai để bật lại; các lựa chọn nhắc trước mốc đã qua cũng bị khóa. Mục cả ngày tính đến cuối ngày/khoảng ngày đã chọn, vẫn cho nhắc vào một giờ cụ thể còn ở tương lai trong khoảng đó. Form tự kiểm tra lại khi đến mốc hoặc khi quay lại tab. Cấu hình cũ vẫn được giữ để không làm thay đổi dữ liệu khi chỉ xem/sửa nội dung.


## Nhắc hạn từ lịch được chia sẻ

- Worker gửi cùng lượt nhắc do chủ lịch chọn tới chủ lịch và những tài khoản đang nhận chia sẻ đúng phạm vi Task, sự kiện hoặc Notes. Không gửi ngược chiều hoặc qua người trung gian. Khi cả hai cùng chia sẻ thì mỗi chiều được xét độc lập.
- Mục riêng tư chỉ nhắc chủ lịch. Notes cần cả ghi chú và lịch hẹn liên kết đều không riêng tư, chưa lưu trữ. Thu hồi quyền, bỏ phạm vi chia sẻ, xóa mục hoặc bật riêng tư sẽ chặn cả thông báo đã gửi trong danh sách, số chưa đọc, phần đã ẩn và API thao tác. Realtime yêu cầu tải lại thông báo sau các thay đổi này.
- Mỗi tài khoản có thông báo và trạng thái đã đọc/ẩn riêng. Cài đặt nhận nhắc hạn của từng người được áp dụng độc lập; chủ lịch tắt nhận không làm người xem bị tắt theo. Nhắc lại sau một giờ là thao tác riêng của chủ mục, không phát lại cho người xem.
- Không nhận lịch chia sẻ: ẩn nhãn nguồn cá nhân. Có nhận lịch chia sẻ: mục của mình ghi **Của bạn**, mục được chia sẻ ghi **Của [chức danh/vị trí]**, thiếu chức danh dùng họ tên chủ lịch. Nhãn đọc từ hồ sơ hiện tại. Thông báo từ ứng dụng doanh nghiệp giữ tên nguồn ứng dụng.
- Mở thông báo chia sẻ dẫn tới lịch được chia sẻ ở chế độ chỉ xem. Quyền được kiểm tra lại khi mở. Không tạo lại nhắc đã xử lý khi thêm người xem sau thời điểm gửi.
- Migration `notifications_004_shared_calendar_reminders` thêm `notifications.calendar_owner_id` nullable (FK xóa theo chủ lịch) và index; lịch sử cá nhân cũ giữ nguyên. Mọi API thông báo dùng chung cùng bộ kiểm tra quyền, gồm cả API dành cho ba ứng dụng doanh nghiệp.


## Nhắc khi chưa có hạn hoặc chưa gắn lịch

Task chưa có hạn và Notes chưa gắn lịch vẫn cho chọn **Chọn ngày và giờ…**. Thời điểm phải ở tương lai; các lựa chọn đúng giờ/trước 15 phút, 30 phút… chỉ dùng khi có mốc để tính. Sự kiện tiếp tục bắt buộc có khoảng ngày giờ. Khi hạn hoặc lịch hẹn chưa qua, các giới hạn trước hạn/trước kết thúc vẫn áp dụng. Khi đã qua, chọn ngày giờ nhắc mới ở tương lai mà không cần Dời lịch.

Notes không cần tạo lịch hẹn giả để gửi nhắc: `notes.reminder_at` và `reminder_version` lập job qua `notification_jobs.note_id`. Mở thông báo dẫn tới ghi chú. Gắn Notes vào lịch chuyển sang cấu hình nhắc trong lịch hẹn và hủy job riêng, tránh nhắc trùng. Lưu trữ, xóa hoặc tắt nhắc đều hủy job chưa gửi. Xóa hạn Task giữ nhắc theo ngày giờ cụ thể, còn nhắc tương đối phải được bỏ hoặc chọn lại.

Phạm vi chia sẻ lịch vẫn chỉ gồm Task có hạn và Notes đã gắn lịch như phần chọn quyền đã ghi; nhắc của Task chưa có hạn/Notes chưa gắn lịch chỉ thuộc chủ tài khoản. Không mở rộng quyền xem kho Notes thông qua thông báo.

Migration `notifications_005_standalone_note_reminders` thêm các cột nhắc của Notes và FK `note_id` trong queue/inbox; tự chạy khi khởi động, không thay đổi ngày giờ/nội dung cũ. Đã kiểm thử tạo, cập nhật, không đổi dữ liệu, gửi đúng một lần, lưu trữ/khôi phục, xóa, chuyển sang lịch hẹn và kiểm tra quyền trên SQLite/PostgreSQL.


### Bỏ một cấu hình nhắc không còn hợp lệ

Khi lịch chưa hợp lệ (thiếu ngày/giờ hoặc khoảng kết thúc không sau bắt đầu) nhưng đang có cấu hình nhắc, danh sách vẫn mở để chọn **Không nhắc**; các lựa chọn đặt nhắc mới và ô ngày giờ nhắc bị khóa. Khi lịch hợp lệ về cấu trúc, cả lịch quá khứ, hiện tại và tương lai đều cho sửa ngày giờ nhắc. Nhắc tương đối đã rơi vào quá khứ bị vô hiệu hóa; nhắc tùy chỉnh mới phải ở tương lai. Trong lúc đang lưu/kiểm tra yêu cầu, tất cả điều khiển vẫn khóa để tránh ghi trùng. Quy tắc dùng chung cho Task, Notes, sự kiện và Dời lịch; backend tiếp tục từ chối tạo nhắc trong quá khứ.


### Kiểm tra biên của thời gian nhắc

Ma trận kiểm thử bao gồm 134 tổ hợp tạo mới: Task không hạn/có giờ/cả ngày, Notes độc lập/đã gắn lịch, sự kiện quá khứ/đang diễn ra/tương lai; không nhắc, nhắc ở quá khứ/đúng hiện tại/tương lai/đúng hạn/đúng kết thúc và nhắc tương đối. Các kiểm tra vòng đời bổ sung bao gồm bật/tắt, thay cấu hình, xung đột phiên bản, lưu không đổi, hoàn thành/lưu trữ/khôi phục và không gửi trùng. Chạy cùng hợp đồng trên SQLite và PostgreSQL trong schema tạm.

Một cấu hình nhắc mới ở quá khứ bị từ chối cả khi Task đã hoàn thành hoặc Notes đã lưu trữ. Vẫn cho lưu trữ/khôi phục một cấu hình cũ đã qua mà không sửa nó, nhưng không gửi lại nhắc cũ. Việc lưu trữ cùng lúc với đổi sang một thời điểm nhắc đã qua phải báo lỗi và hoàn tác toàn bộ thay đổi.

Ô ngày giờ chỉ nhận phút: không gợi ý phút quá khứ khi chỉ còn vài giây trước kết thúc. Nếu không còn phút tương lai hợp lệ trước kết thúc, tạm ngừng lựa chọn tạo nhắc tùy chỉnh và giải thích lý do; khi mục kết thúc, tự cho chọn nhắc tương lai trở lại. Những cấu hình có sẵn vẫn có thể bỏ bằng Không nhắc. Task có giờ vẫn được nhắc đúng hạn, khác với giới hạn kết thúc loại trừ của Notes/sự kiện.
