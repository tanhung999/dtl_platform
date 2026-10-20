# Phân trang công việc

Widget To-Do lấy tối đa 8 công việc mỗi trang, có Trang trước/Trang sau và nút **Xem tất cả công việc (n)**. Trang đầy đủ dùng cùng trình sửa và danh sách, lấy 25 công việc/trang, có tìm kiếm và các bộ lọc Tất cả/Chưa làm/Đã xong/Quá hạn. Hai chế độ giữ bộ lọc, vị trí trang và từ khóa riêng trong phiên mở trang. Đổi bộ lọc hoặc từ khóa về trang đầu; quay lại Workspace khôi phục trang widget đang xem.

API `/api/tasks/collection` nhận `limit`, `offset`, `after`, `filter` và `q`. Tìm kiếm phía server trên tiêu đề/mô tả, không phân biệt dấu hoặc hoa/thường; ký tự `%`/`_` được hiểu theo nghĩa đen. Giao diện chờ 300 ms trước khi gửi từ khóa; từ khóa một ký tự không trả kết quả và có hướng dẫn nhập ít nhất hai ký tự. Trường `total` đếm kết quả đang lọc/tìm kiếm, còn `counts` luôn đếm toàn bộ công việc thuộc tài khoản. Nhóm quá hạn riêng và API theo khoảng ngày của Calendar không bị giới hạn bởi trang hay từ khóa To-Do.

Thứ tự: chưa hoàn thành trước, hạn thực tế gần nhất, mức ưu tiên rồi ID ổn định. Giữ cursor đang dùng khi chuyển trang; dữ liệu thay đổi hoặc quay lại tab thì làm mới danh sách và bỏ cursor cũ. Nếu trang cuối vượt phạm vi sau khi xóa, server dùng trang hợp lệ gần nhất và bỏ cursor không còn tương ứng.

Migration `tasks_001_server_search` bổ sung `tasks.search_text` đã chuẩn hóa, điền dữ liệu cũ theo lô 500 bản ghi và tạo chỉ mục `pg_trgm` trên PostgreSQL. Cột nội bộ này không được tải kèm bản ghi công việc thông thường và không trả trong API. Không thay đổi tiêu đề, mô tả, phiên bản hoặc thời gian cập nhật khi backfill. Khi sửa tiêu đề/mô tả qua ORM, dữ liệu tìm kiếm tự cập nhật. Với lệnh SQL nhập trực tiếp, cần điền `search_text` theo `fold_text` hoặc chạy công cụ backfill phù hợp.

Kiểm tra: `backend/tests/integration/test_task_pages_search.py`, `frontend/tests/browser/task-pagination-browser.cjs`, các bài Tasks, Calendar và realtime hiện hành. Migration chạy tự động sau khi cập nhật source và dựng lại backend.
