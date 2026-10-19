# Giao diện website

Bộ chọn nằm ngay bên trái chuông thông báo và trên trang đăng nhập. Bảy lựa chọn:

| Mã | Tên | Phong cách |
| --- | --- | --- |
| `light` | Corporate Light | Sáng mặc định, nền trắng xanh |
| `dark` | Midnight Dark | Tối mặc định, nền xanh đen |
| `aurora` | Aurora Glass | Nền xanh tím, thẻ kính mờ |
| `ivory` | Ivory & Forest | Nền ngà, điểm nhấn xanh rừng |
| `sunset` | Sunset Coral Glass | Kính hồng đào, nền hoàng hôn tím cam |
| `obsidian` | Obsidian Titanium | Nền titan tối, điểm nhấn bạc hà |
| `emerald` | Emerald Aurora | Nền xanh ngọc, bề mặt sáng dịu |

Bấm thẻ để áp dụng ngay, dấu tick chỉ lựa chọn hiện tại. Bấm ngoài, nút đóng hoặc Esc để đóng. Hỗ trợ phím mũi tên và Home/End trong nhóm lựa chọn. Hộp chọn được đưa vào portal, giới hạn theo màn hình và cuộn được khi chiều cao nhỏ.

Lựa chọn lưu ở `localStorage.dtl_theme` trên trình duyệt, chưa đồng bộ theo tài khoản hoặc giữa các thiết bị. Giữ tương thích giá trị `light`/`dark` cũ. Không có lựa chọn hợp lệ thì dùng Sáng. Nếu không đọc/ghi được lựa chọn theme, bộ chọn vẫn đổi theme cho phiên hiện tại. Script khởi tạo trong `index.html` áp dụng trước khi React hiển thị để hạn chế chớp nền sai khi tải lại.

Các bảng màu dùng biến CSS chung trong `src/themes.css`; thành phần đọc biến hiện có. Không thay màu ghi chú do người dùng chọn hoặc màu mang ý nghĩa ưu tiên/trạng thái. Theme không thay bố cục, không yêu cầu database và không gọi lại API dữ liệu. Hiệu ứng nền tạo bằng CSS, không tải ảnh nền lớn; kính mờ áp dụng cho các khung chính và có nền dự phòng. Tôn trọng tùy chọn giảm chuyển động của hệ điều hành.

Kiểm tra TypeScript: `node node_modules/typescript/bin/tsc --noEmit` trong `frontend`. Kiểm tra thực tế: `node tests/browser/theme-picker-browser.cjs`, cần Docker và Playwright như hướng dẫn tại `frontend/tests/README.md`.

Obsidian dùng chế độ tối cho ô nhập, màu ưu tiên và các trạng thái cảnh báo. Nút nhấn bạc hà dùng chữ tối để đảm bảo tương phản. Bộ chọn cuộn riêng danh sách, giữ tiêu đề và nút đóng cố định khi có nhiều theme.
