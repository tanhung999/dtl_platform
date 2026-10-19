# Tự động dọn thứ tự Workspace

`workspace_layouts.ordered_ids` chỉ giữ ID mục còn hiển thị và người dùng được phép xem.
Xóa hoặc lưu trữ Ghi chú tự loại ID khỏi thứ tự trong cùng giao dịch; xóa Bookmark
cũng dọn thứ tự tương ứng. Liên kết chung được loại khỏi thứ tự của mọi người dùng.
Mỗi thứ tự thực sự thay đổi tăng `version` và phát thời gian thực sau khi xác nhận giao dịch.
Nếu giao dịch lỗi, cả dữ liệu mục và thứ tự đều hoàn tác giao dịch.

Khi lưu thứ tự, API bỏ ID đã bị xóa và Ghi chú của chính người dùng đã lưu trữ.
ID mục riêng tư của người khác và yêu cầu ghim mục không hợp lệ vẫn bị từ chối.
Kiểm tra `expected_version` giữ nguyên để tab cũ không ghi đè thứ tự mới.
Khôi phục Ghi chú không phục hồi vị trí cũ; mục dùng quy tắc hiển thị mặc định cho
đến lần sắp xếp tiếp theo.

Bản nâng cấp cơ sở dữ liệu `workspace_001_prune_order_ids` chạy một lần khi máy chủ khởi động,
dọn ID cũ, trùng, không thuộc quyền xem và ứng dụng đã bỏ khỏi danh mục.
Bản nâng cấp cơ sở dữ liệu giữ thứ tự tương đối của ID hợp lệ, không xóa Ghi chú hoặc Liên kết.
Có thể chạy bằng `python -m app.db.migrations` với cấu hình cơ sở dữ liệu cần cập nhật.
Không cần cron hay thao tác dọn định kỳ. Không thêm bảng/cột riêng cho việc dọn ID.

Kiểm tra: từ `backend`, chạy
`python -m unittest discover -s tests -p "test_workspace*.py" -v`.
Các kiểm thử dùng SQLite trong bộ nhớ, kiểm tra xóa/lưu trữ/khôi phục, quyền sở hữu,
phiên bản, hoàn tác giao dịch, thời gian thực, liên kết chung và bản nâng cấp cơ sở dữ liệu chạy lặp an toàn.
