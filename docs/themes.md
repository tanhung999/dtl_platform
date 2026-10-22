# Giao diện website

Bộ chọn nằm ngay bên trái chuông thông báo và trên trang đăng nhập. Chín lựa chọn:

| Mã | Tên | Phong cách |
| --- | --- | --- |
| `light` | Corporate Light | Sáng mặc định, nền trắng xanh |
| `dark` | Midnight Dark | Tối mặc định, nền xanh đen |
| `aurora` | Aurora Glass | Nền xanh tím, thẻ kính mờ |
| `ivory` | Ivory & Forest | Nền xanh rừng và ngà ấm, bề mặt sáng |
| `sunset` | Sunset Coral Glass | Kính hồng đào, nền hoàng hôn tím cam |
| `obsidian` | Obsidian Titanium | Nền titan tối, điểm nhấn bạc hà |
| `emerald` | Emerald Aurora | Nền xanh ngọc, bề mặt sáng dịu |
| `princess-pink` | Rose Quartz | Nền hồng rose rõ sắc, thẻ trắng |
| `fairy-purple` | Lavender Aura | Nền lavender rõ sắc, thẻ trắng |

Bấm thẻ để áp dụng ngay, dấu tick chỉ lựa chọn hiện tại. Bấm nút X để đóng; bấm ngoài hoặc Esc giữ nguyên hộp chọn. Hỗ trợ phím mũi tên và Home/End trong nhóm lựa chọn. Hộp chọn được đưa vào portal, giới hạn theo màn hình và cuộn được khi chiều cao nhỏ.

Lựa chọn lưu ở `localStorage.dtl_theme` trên trình duyệt, chưa đồng bộ theo tài khoản hoặc giữa các thiết bị. Giữ tương thích giá trị `light`/`dark` cũ. Không có lựa chọn hợp lệ thì dùng Sáng. Nếu không đọc/ghi được lựa chọn theme, bộ chọn vẫn đổi theme cho phiên hiện tại. Script khởi tạo do Vite sinh vào HTML áp dụng trước khi React hiển thị để hạn chế chớp nền sai khi tải lại.

Nguồn khai báo duy nhất là `frontend/src/theme/catalog.json`: tên, icon, chế độ sáng/tối, token chung và màu từng theme. Bộ chọn và preview đọc trực tiếp catalog; Vite sinh CSS token và script khởi tạo trong HTML từ cùng dữ liệu. `src/themes.css` chỉ giữ quy tắc hiệu ứng chung. Không thay màu ghi chú do người dùng chọn hoặc màu mang ý nghĩa ưu tiên/trạng thái. Theme không thay bố cục, không yêu cầu database và không gọi lại API dữ liệu. Hiệu ứng nền dùng CSS gradient, không tải ảnh nền lớn; kính mờ áp dụng cho các khung chính và có nền dự phòng. Tôn trọng tùy chọn giảm chuyển động của hệ điều hành.

Kiểm tra TypeScript: `node node_modules/typescript/bin/tsc --noEmit` trong `frontend`. Kiểm tra thực tế: `node tests/browser/theme-picker-browser.cjs`, cần Docker và Playwright như hướng dẫn tại `frontend/tests/README.md`.

Obsidian dùng chế độ tối cho ô nhập, màu ưu tiên và các trạng thái cảnh báo. Nút nhấn bạc hà dùng chữ tối để đảm bảo tương phản. Bộ chọn cuộn riêng danh sách, giữ tiêu đề và nút đóng cố định khi có nhiều theme.

## Thêm hoặc sửa theme

Sửa `src/theme/catalog.json`, chọn `mode` là `light`/`dark` và icon có trong bộ chọn. Các token được hợp nhất theo thứ tự: common → nền tảng light → chế độ → token riêng. Không sửa whitelist HTML hoặc thêm selector theo tên theme. Tên theme mới được suy ra thành kiểu TypeScript, CSS và đoạn khởi tạo khi build. Preview dùng đúng nền, màu nhấn, bề mặt và viền của palette đó.

Token `--on-accent`, `--calendar-selected-bg`, `--on-calendar-selected`, `--glass-filter`, `--app-card-bg` và các token bề mặt giúp thành phần tránh override riêng theo tên theme. Màu ưu tiên/status và màu Notes do người dùng chọn vẫn độc lập. `data-color-mode` điều khiển các biến thể tối của thành phần. Khi đổi catalog trong dev, Vite theo dõi cấu hình phụ thuộc và nạp lại để CSS đầu trang cùng phiên bản với React.

Build kiểm tra TypeScript cho cả ứng dụng và cấu hình Vite bằng hai project độc lập, không phát sinh declaration/build-info trong source.

## Đo hiệu ứng kính

Chạy `THEME_PERF=1 node tests/browser/theme-picker-browser.cjs` từ frontend; PowerShell dùng `$env:THEME_PERF='1'` trước lệnh, rồi xóa biến khi xong. Bài kiểm tra dùng tài khoản tạm, so sánh cuộn có/không blur ở Aurora/Sunset/Emerald, viewport 1366×768, CPU throttle 4 lần, đảo thứ tự hai lượt. Báo cáo tại `.audit-backups/theme-performance-20261019.json`, được Git bỏ qua. Đây là phép đo chẩn đoán trên máy hiện tại, không giả lập GPU yếu, không chứng minh tốc độ trên mọi điện thoại và không có ngưỡng pass/fail tùy tiện. Giữ nguyên mức blur nếu chưa có bằng chứng cần giảm.

Kết quả chẩn đoán ngày 19/10/2026 trên fixture nhẹ: p95 khoảng cách khung hình khoảng 16,8 ms ở cả ba theme, có và không blur. Có vài khung trên 32 ms, nhưng phép đo ngắn này chưa đủ chứng minh lợi ích đáng kể khi bỏ blur; do đó giữ nguyên hiệu ứng. Cần chạy thêm trên phần cứng/GPU yếu và dữ liệu dày nếu có phản ánh giật.

## Độ tương phản và khả năng đọc

Cả 9 theme có kiểm tra chữ chính, chữ phụ, gợi ý và liên kết trên nền thẻ, nền phụ, ô nhập và vùng chọn. Mục tiêu cho chữ thông thường là tỷ lệ tương phản tối thiểu 4,5:1. Kiểm tra cả màu nút đặc và từng điểm màu của gradient, cảnh báo/lỗi/thành công và chữ trạng thái lịch. Nút màu sáng của Midnight/Obsidian dùng chữ tối; phần còn lại dùng màu chữ phù hợp với nền nút.

`--accent-text` tách màu chữ liên kết khỏi màu nhấn trang trí. `--error`, `--error-bg`, `--success-text`, `--success-bg`, `--warning-text` và `--status-*-text` cung cấp màu chữ/bề mặt theo mode. Profile và Login không dùng chữ tối cố định trên thẻ tối. Giữ sắc hồng/tím/xanh của từng theme, điều chỉnh sắc độ của chữ và nút để đọc rõ hơn.

Notes có sáu màu giấy sáng độc lập với theme; editor dùng bộ màu chữ/ô nhập sáng riêng, kể cả khi chọn theme tối. Cảnh báo vẫn dùng chữ nâu đậm trên nền giấy, tránh màu vàng sáng chìm vào nền. Không thay màu giấy người dùng đã chọn. Sự kiện đã kết thúc không giảm opacity của cả thẻ làm mờ chữ; viền/chấm và nền xanh lá vẫn phân biệt trạng thái.

Kiểm thử: `tests/unit/theme-contrast.test.cjs` bảo vệ tỷ lệ tương phản màu khai báo; `tests/browser/theme-reading-browser.cjs` kiểm tra màu chữ thực tế ở Login, Workspace, Profile và Notes với cả sáu màu giấy trên đủ chín theme. Các vùng tô gradient được kiểm tra theo từng điểm màu trong unit test; vùng không gradient được tính thêm các lớp nền trong trình duyệt. `theme-picker-browser.cjs` vẫn kiểm tra lưu lựa chọn, bàn phím, màn hình nhỏ và đổi theme không tải lại dữ liệu.


Kiểm tra khả năng đọc sau khi đổi bố cục trang chủ: `theme-reading-browser.cjs` dùng sidebar mới và kiểm tra thêm tìm kiếm, thông báo, ứng dụng, công việc, lịch, liên kết nhanh; phép đo tính cả độ mờ của các lớp cha. Chữ phụ Aurora được làm đậm hơn để đọc trên nền kính. Nhãn quá hạn dùng màu lỗi theo theme; công việc đã hoàn thành dùng gạch ngang thay vì làm mờ chữ. Ô ngày giờ khóa giữ nền riêng và con trỏ cấm, không làm mờ toàn bộ nội dung.

Các nút ghim, mở lịch và dời lịch trong ghi chú dùng màu nhấn theo theme. `--accent-on-paper` cung cấp sắc độ đậm đủ đọc trên sáu màu giấy sáng, kể cả khi giao diện chính ở chế độ tối. Ngày được chọn trên lịch dùng `--calendar-selected-bg` và `--on-calendar-selected`; mặc định đi theo màu nhấn và màu chữ của nút trong theme. Màu trạng thái lịch và ưu tiên công việc vẫn giữ ý nghĩa riêng.
