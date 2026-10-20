# Giao diện website

Bộ chọn nằm ngay bên trái chuông thông báo và trên trang đăng nhập. Chín lựa chọn:

| Mã | Tên | Phong cách |
| --- | --- | --- |
| `light` | Corporate Light | Sáng mặc định, nền trắng xanh |
| `dark` | Midnight Dark | Tối mặc định, nền xanh đen |
| `aurora` | Aurora Glass | Nền xanh tím, thẻ kính mờ |
| `ivory` | Ivory & Forest | Nền ngà, điểm nhấn xanh rừng |
| `sunset` | Sunset Coral Glass | Kính hồng đào, nền hoàng hôn tím cam |
| `obsidian` | Obsidian Titanium | Nền titan tối, điểm nhấn bạc hà |
| `emerald` | Emerald Aurora | Nền xanh ngọc, bề mặt sáng dịu |
| `princess-pink` | Princess Pink | Hồng kẹo, hoa hồng, trái tim và nơ |
| `fairy-purple` | Fairy Purple | Lavender, pha lê, bướm và ánh sao |

Bấm thẻ để áp dụng ngay, dấu tick chỉ lựa chọn hiện tại. Bấm nút X để đóng; bấm ngoài hoặc Esc giữ nguyên hộp chọn. Hỗ trợ phím mũi tên và Home/End trong nhóm lựa chọn. Hộp chọn được đưa vào portal, giới hạn theo màn hình và cuộn được khi chiều cao nhỏ.

Lựa chọn lưu ở `localStorage.dtl_theme` trên trình duyệt, chưa đồng bộ theo tài khoản hoặc giữa các thiết bị. Giữ tương thích giá trị `light`/`dark` cũ. Không có lựa chọn hợp lệ thì dùng Sáng. Nếu không đọc/ghi được lựa chọn theme, bộ chọn vẫn đổi theme cho phiên hiện tại. Script khởi tạo do Vite sinh vào HTML áp dụng trước khi React hiển thị để hạn chế chớp nền sai khi tải lại.

Nguồn khai báo duy nhất là `frontend/src/theme/catalog.json`: tên, mô tả, icon, chế độ sáng/tối, token chung và màu từng theme. Bộ chọn và preview đọc trực tiếp catalog; Vite sinh CSS token và script khởi tạo trong HTML từ cùng dữ liệu. `src/themes.css` chỉ giữ quy tắc hiệu ứng chung. Không thay màu ghi chú do người dùng chọn hoặc màu mang ý nghĩa ưu tiên/trạng thái. Theme không thay bố cục, không yêu cầu database và không gọi lại API dữ liệu. Hiệu ứng nền dùng CSS và SVG vector nhỏ trong `public/themes/`, không tải ảnh nền lớn; kính mờ áp dụng cho các khung chính và có nền dự phòng. Tôn trọng tùy chọn giảm chuyển động của hệ điều hành.

Kiểm tra TypeScript: `node node_modules/typescript/bin/tsc --noEmit` trong `frontend`. Kiểm tra thực tế: `node tests/browser/theme-picker-browser.cjs`, cần Docker và Playwright như hướng dẫn tại `frontend/tests/README.md`.

Obsidian dùng chế độ tối cho ô nhập, màu ưu tiên và các trạng thái cảnh báo. Nút nhấn bạc hà dùng chữ tối để đảm bảo tương phản. Bộ chọn cuộn riêng danh sách, giữ tiêu đề và nút đóng cố định khi có nhiều theme.

## Thêm hoặc sửa theme

Sửa `src/theme/catalog.json`, chọn `mode` là `light`/`dark` và icon có trong bộ chọn. Các token được hợp nhất theo thứ tự: common → nền tảng light → chế độ → token riêng. Không sửa whitelist HTML hoặc thêm selector theo tên theme. Tên theme mới được suy ra thành kiểu TypeScript, CSS và đoạn khởi tạo khi build. Preview dùng đúng nền, màu nhấn, bề mặt và viền của palette đó.

Token `--on-accent`, `--calendar-selected-bg`, `--on-calendar-selected`, `--glass-filter`, `--app-card-bg` và các token bề mặt giúp thành phần tránh override riêng theo tên theme. Màu ưu tiên/status và màu Notes do người dùng chọn vẫn độc lập. `data-color-mode` điều khiển các biến thể tối của thành phần. Khi đổi catalog trong dev, Vite theo dõi cấu hình phụ thuộc và nạp lại để CSS đầu trang cùng phiên bản với React.

Build kiểm tra TypeScript cho cả ứng dụng và cấu hình Vite bằng hai project độc lập, không phát sinh declaration/build-info trong source.

## Đo hiệu ứng kính

Chạy `THEME_PERF=1 node tests/browser/theme-picker-browser.cjs` từ frontend; PowerShell dùng `$env:THEME_PERF='1'` trước lệnh, rồi xóa biến khi xong. Bài kiểm tra dùng tài khoản tạm, so sánh cuộn có/không blur ở Aurora/Sunset/Emerald, viewport 1366×768, CPU throttle 4 lần, đảo thứ tự hai lượt. Báo cáo tại `.audit-backups/theme-performance-20261019.json`, được Git bỏ qua. Đây là phép đo chẩn đoán trên máy hiện tại, không giả lập GPU yếu, không chứng minh tốc độ trên mọi điện thoại và không có ngưỡng pass/fail tùy tiện. Giữ nguyên mức blur nếu chưa có bằng chứng cần giảm.

Kết quả chẩn đoán ngày 19/10/2026 trên fixture nhẹ: p95 khoảng cách khung hình khoảng 16,8 ms ở cả ba theme, có và không blur. Có vài khung trên 32 ms, nhưng phép đo ngắn này chưa đủ chứng minh lợi ích đáng kể khi bỏ blur; do đó giữ nguyên hiệu ứng. Cần chạy thêm trên phần cứng/GPU yếu và dữ liệu dày nếu có phản ánh giật.

Princess Pink và Fairy Purple giữ màu nền/nhấn/widget/viền theo bảng màu đã chọn. `--accent-text` cho chữ sắc đậm dễ đọc, độc lập với màu nhấn trang trí; bảy theme cũ mặc định dùng lại `--accent`. Họa tiết ở mép nền không nhận thao tác, SVG chỉ hoạt họa độ trong suốt của hai nhóm sao và dừng khi `prefers-reduced-motion: reduce`. Không thay bố cục, màu Notes hay màu trạng thái Lịch.
