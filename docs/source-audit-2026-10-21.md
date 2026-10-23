# Rà soát và sửa mã nguồn ngày 21/10/2026

## Các lỗi đã sửa

| Phần | Lỗi xác nhận | Cách xử lý |
| --- | --- | --- |
| Liên kết nhanh | API chấp nhận URL script, tên rỗng và chuỗi vượt độ dài cột | Chỉ nhận HTTP/HTTPS không chứa thông tin đăng nhập; chuẩn hóa và giới hạn đầu vào ở cả hai phía |
| Liên kết nhanh | Bấm nhiều lần/mất phản hồi có thể tạo trùng | Chặn gửi đồng thời; UUID yêu cầu dùng lại khi thử lại; server lưu receipt trong cùng giao dịch và không tạo lại mục đã xóa |
| Liên kết nhanh | Realtime tải danh sách rồi frontend thêm thẻ một lần nữa | Đọc lại danh sách chuẩn từ server sau thay đổi, bỏ append cục bộ |
| Liên kết nhanh | Lỗi chỉ ghi console; phản hồi đọc cũ có thể ghi đè danh sách; lần tải thành công có thể xóa lỗi ghi | Hiện lỗi và nút thử lại; hủy lần đọc cũ; tách lỗi đọc/ghi; giữ bản nhập khi chưa xác định kết quả |
| Hồ sơ | Tên toàn khoảng trắng hoặc chuỗi vượt độ dài database vẫn được gửi | Cắt khoảng trắng và kiểm tra tên, giới hạn 120/30/100/150 ký tự cho tên/điện thoại/chức danh/địa điểm; bio 10.000 ký tự; bổ sung maxLength ở giao diện |
| Nhắc hạn | Cảnh báo không tự đổi khi giờ nhắc tùy chỉnh vừa qua nhưng mục chưa kết thúc | Lập lịch cập nhật tại thời điểm nhắc đã chọn, ngoài các mốc bắt đầu/kết thúc |
| Đăng nhập và văn bản | Hiện mật khẩu khởi tạo công khai; viết hoa nhãn không nhất quán | Bỏ dòng tài khoản/mật khẩu mặc định khỏi giao diện, dùng hướng dẫn liên hệ quản trị; sửa nhãn hồ sơ và liên kết |
| Mã/dữ liệu cũ | Model, relationship và migration snooze phục vụ nhắc tự động đã ngừng | Bỏ model/relationship/migration cũ và import liên quan; migration mới bỏ bảng receipt cũ |

## Dữ liệu

Đã sao lưu PostgreSQL cục bộ vào `.audit-backups/before-source-audit-2026-10-21.dump` trước khi dọn.
Migration `notifications_003_retire_implicit_receipts` bỏ `task_reminder_receipts` cùng 2 bản ghi ẩn nhắc thuộc cơ chế tự động cũ; không còn luồng đang hoạt động nào đọc bảng này. Migration chạy lại an toàn và database mới không tạo lại bảng.

Kiểm tra database cục bộ không có Task/Notes mất chủ sở hữu, mapping Notes–Calendar mồ côi hoặc khác chủ sở hữu, khoảng sự kiện có kết thúc trước/bằng bắt đầu, job đang chờ không có tài nguyên hoặc có cả Task/Event, và bookmark rỗng/URL ngoài HTTP(S). Không có job đã xử lý quá thời hạn giữ 30 ngày cần dọn thêm.

Giữ `workspace_versions` vì SSE dùng để khôi phục phiên và phát hiện thay đổi. Giữ các receipt tạo mục/dời lịch vì chúng ngăn gửi lại mã cũ tạo trùng hoặc hồi sinh dữ liệu đã xóa. Giữ lịch sử thông báo, dữ liệu người dùng và nhãn hạn cũ chưa chuyển đổi được.

## Kiểm tra

- Toàn bộ backend: 135 kiểm thử, bao gồm validation, quyền, giao dịch, no-op, migration và replay.
- Frontend: 55 kiểm thử; TypeScript kiểm tra cả import/biến/tham số không dùng; build production thành công.
- Trình duyệt: lỗi tải/thử lại liên kết, URL không an toàn, mất phản hồi sau khi lưu rồi thử lại cùng UUID, không nhân đôi thẻ, xóa và realtime, cảnh báo khi giờ nhắc vừa trôi qua, khóa/giới hạn nhắc, lưu Task/Notes/Event/Profile không thay đổi không gọi API ghi.

Đây là kết quả rà soát mã và các luồng đã kiểm chứng, không phải cam kết không còn lỗi trong mọi tình huống production. Dòng mật khẩu khởi tạo được gỡ khỏi UI; mật khẩu đã tồn tại và khóa bảo mật triển khai không bị thay đổi trong đợt này.
