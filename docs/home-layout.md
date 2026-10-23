# Trang chủ

Thanh đầu trang giữ logo, tìm kiếm, đồng hồ, chọn theme, thông báo, hồ sơ và đăng xuất. Thanh tìm kiếm gọi `GET /api/search` trên server, không lọc nội dung bằng RAM của trình duyệt; hỗ trợ tiếng Việt không dấu. Người dùng bấm vào ô để tìm kiếm; không có phím tắt tìm kiếm. Xóa hết nội dung (hoặc chỉ còn khoảng trắng) tự trở về trang chủ. Phạm vi gồm ứng dụng được cấp quyền, tiêu đề/nội dung công việc, ghi chú chưa lưu trữ, tiêu đề/mô tả/địa điểm sự kiện của chính tài khoản. Ghi chú đã gắn lịch chỉ xuất hiện trong nhóm Ghi chú, không lặp lại ở nhóm Sự kiện.

Nhập ít nhất hai ký tự; chờ 300 ms sau lần gõ cuối để gửi yêu cầu, hủy truy vấn cũ khi đổi từ khóa. Kết quả không được cache; truy vấn lại cùng từ khóa vẫn gọi server. Mỗi nhóm hiển thị tối đa năm kết quả; Xem tất cả mở phân trang 20 mục. Bấm kết quả để mở biểu mẫu chi tiết hiện có. Chỉnh sửa/xóa dữ liệu qua realtime làm mới kết quả tìm kiếm. Nội dung lịch được chia sẻ không nằm trong phạm vi tìm kiếm này.

Sidebar dẫn đến Trang chủ, Ứng dụng, Công việc, Lịch, Ghi chú, Liên kết nhanh và Hồ sơ. Quản trị chỉ hiện khi tài khoản có quyền. Lựa chọn thu gọn sidebar được lưu trên trình duyệt; màn hình nhỏ dùng thanh điều hướng cuộn ngang.

Trang chủ có banner gọn với câu “Một nền tảng thống nhất cho các công cụ và dữ liệu doanh nghiệp”, ứng dụng doanh nghiệp, ba ô truy cập nhanh và liên kết nhanh. Lịch cá nhân nằm ở cột phải. Không thêm các mục Tài liệu, Báo cáo hoặc Yêu thích, không hiển thị danh sách Task/Notes xem trước hay thêm nội dung dưới lịch.

Các trang dùng cùng token màu của cả chín theme. Ứng dụng doanh nghiệp vẫn mở qua SSO; nếu trình duyệt chặn tab mới thì hiện liên kết để người dùng mở lại.

Kiểm tra giao diện sau khi build bằng `PLATFORM_BASE_URL=<url> node frontend/tests/browser/home-redesign-browser.cjs` (PowerShell đặt biến qua `$env:PLATFORM_BASE_URL`). Script tạo và dọn tài khoản QA riêng, kiểm tra điều hướng, tạo ghi chú/công việc, tìm ứng dụng, liên kết nhanh, SSO giả lập, thông báo, chín theme và chiều rộng 360–1672 px.


Icon Công việc dùng ảnh checklist nền trong suốt `frontend/src/assets/icon-tasks.png` (256 × 256), đăng ký qua `featureIcons` và hiển thị bằng `FeatureIcon` ở truy cập nhanh, tiêu đề trang và widget Công việc. Các biểu tượng thao tác và điều hướng vẫn theo bộ nét chung.

Liên kết nhanh dùng các ô có chiều rộng theo nội dung, tối đa 280 px trên máy tính, tự xuống hàng khi cần. Tên dài rút gọn bằng dấu ba chấm và có tooltip tên/URL đầy đủ. Nút Thêm chỉ nằm ở tiêu đề; mở biểu mẫu đưa con trỏ vào trường tên.
