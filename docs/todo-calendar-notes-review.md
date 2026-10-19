# Rà soát To-Do, Calendar và Notes — 16/10/2026

## Đã xử lý

- Tách bộ lọc Sự kiện/Ghi chú, số đếm đầy đủ và chấm mini-calendar. Lọc ở SQL trước giới hạn 500 để nhóm bị ẩn không chiếm chỗ của nhóm đang hiện. Bộ đếm và truy vấn danh sách dùng JOIN bảng lịch hẹn có khóa duy nhất, không thêm truy vấn theo từng bản ghi.
- To-Do trả `server_now`/`next_refresh_at`. Tính mốc chuyển quá hạn gần nhất trong cùng truy vấn thống kê hiện có; trình duyệt tải ngầm đúng mốc, không quét mỗi phút. Khi không còn việc có hạn thì không đặt lịch tải. Vẫn kiểm tra khi quay lại tab và nhận SSE.
- Lưu trữ Notes lưu cả nội dung và ngày giờ đang sửa. Lỗi phiên bản hoặc ngày giờ giữ nguyên trạng thái trước giao dịch. Đọc lịch hẹn trong chi tiết note chỉ lấy ID, ngày giờ và phiên bản, không tải mô tả sự kiện.

## Các cơ chế đã kiểm tra trong mã nguồn

API giới hạn theo người dùng; các luồng sửa/xóa có kiểm tra phiên bản; tạo có UUID và biên nhận chống trùng. Nội dung ghi chú hiển thị dạng văn bản qua React, không chèn HTML. Notes dùng xem trước/phân trang/tìm kiếm server; Tasks có cursor và giới hạn trang; Calendar có trần 500 và cờ cắt bớt. SSE có phục hồi, backoff và jitter. Pool PostgreSQL mặc định 8 + 4 mỗi process; khi triển khai phải tính cả số worker và các kết nối nền. Đây là rà soát phạm vi ba chức năng, không thay thế kiểm thử bảo mật đầy đủ hoặc chứng nhận tải production.

## Chưa nên tối ưu bằng suy đoán

1. Đo tải thực tế 200 phiên đang hoạt động, ghi p95, lỗi, thời gian chờ pool và truy vấn chậm. Chưa có bằng chứng lượt sửa này chịu được mức đó trên hạ tầng production.
2. Notes còn OFFSET và tổng đếm chính xác; cân nhắc cursor nếu tài khoản có hàng chục nghìn note và đo thấy trang sâu chậm. Dời Notes vào giữa nhóm vẫn có thể cập nhật nhiều dòng trong một giao dịch; chưa đổi cơ chế khi chưa đo.
3. Calendar có giới hạn 500; các khoảng nhiều ngày có thể sinh nhiều khối trên lưới. Cân nhắc chỉ dựng phần đang nhìn thấy khi dữ liệu thực tế gây giật. Tiêu đề của khối dài có thể cuộn khỏi vùng nhìn thấy; ghim tiêu đề trong khối là cải thiện giao diện riêng.
4. API Notes dạng danh sách cũ vẫn trả nội dung đầy đủ tối đa 200 mục. UI hiện dùng collection xem trước; cần kiểm tra người dùng API cũ trước khi bỏ hoặc siết thêm endpoint này.

Không thêm Redis hay chỉ mục mới trong lượt này. Thay đổi cấu trúc pool/index/cache cần kết quả đo và kiểm tra tính đúng đắn trước.

## Xác minh

- Bộ kiểm thử backend hiện có và `test_calendar_note_filters.py`: bộ lọc trước LIMIT, quyền sở hữu, tổng/chấm ngày, mốc đổi quá hạn và lưu trữ nguyên tử.
- `node tests/browser/calendar-note-filters-browser.cjs`: bật/tắt độc lập, màu ô tick, nhớ sau reload, SSE, chấm ngày và lưu lịch hẹn khi lưu trữ.
- Hồi quy Notes/Tasks và bản build giao diện theo `frontend/tests/README.md`.
