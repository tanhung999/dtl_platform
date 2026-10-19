# Phản hồi khi kéo thả

Phần dùng chung nằm trong `frontend/src/features/drag-feedback/`, nối với
`task-calendar`, `calendar-dnd` và `workspace-layout` qua bộ cung cấp ngữ cảnh của dnd-kit.
Không thêm bảng hay cột cơ sở dữ liệu cho hiệu ứng.

- To-Do, Ghi chú, Liên kết và Ứng dụng chỉ kéo bằng biểu tượng tay cầm.
  Trong lịch (trang đầy đủ và tiện ích), kéo trực tiếp thẻ sự kiện hoặc nội dung hạn công việc;
  ô chọn vẫn dùng để đánh dấu hoàn thành. Tay nắm dùng grab; đang kéo dùng grabbing. Mục gốc mờ 40% và có viền nét đứt.
  Bản sao chỉ giữ tên, ưu tiên và hạn (hoặc tên và giờ sự kiện), không xoay,
  thu còn 95%, có bóng đổ. Thẻ sắp xếp được chỉ giữ tên.
- Ô ngày và ô giờ hợp lệ có nền xanh nhạt. Ô đang rê có viền xanh đậm,
  nhãn nói trước ngày, giờ được giữ hay giờ bị bỏ khi chuyển sang cả ngày.
  Hạn công việc trên lưới có khối xem trước cao 24px, chốt theo bước 15 phút.
- Ngoài vùng thả: con trỏ cấm, bản sao mờ và viền đỏ nhạt. Thả ngoài vùng hoặc
  Escape cho bản sao quay về trong 200ms, rung nhẹ nguồn, không gửi API.
- Vùng giờ tự cuộn khi giữ ở mép khoảng 180ms; mép có gradient.
  Giữ sát trái/phải 700ms để đổi tuần. Lưới có thể cuộn ngang trước khi đổi tuần.
  Hủy, lỗi lưu hoặc Hoàn tác khôi phục tuần ban đầu nếu đã đổi tuần khi kéo.
  Kéo ở giữa ô Chủ nhật không đổi tuần.
- Thả hợp lệ có hiệu ứng 180ms và nháy viền đích. Sau API thành công, mục vừa
  đổi sáng vàng rồi mờ trong 3 giây ở To-Do và Lịch. Danh sách chuyển vị trí
  trong 180ms; số đếm có chuyển động nhẹ và dùng dữ liệu thời gian thực hiện có.
- Thông báo nổi ở góc dưới phải, tự đóng khoảng 6 giây; rê chuột/focus/tác vụ lưu
  tạm dừng. Chỉ hiện một thông báo nổi kéo thả tại một thời điểm. Hoàn tác có kiểm tra
  phiên bản, bao gồm khôi phục trạng thái ghim Ghi chú trước khi kéo.
- Ghi chú, Liên kết và Ứng dụng cập nhật thứ tự ngay khi thả, hoàn lại nếu lưu lỗi.
  Chỉ dùng chuyển động của dnd-kit cho các danh sách này, tránh chạy hiệu ứng hai lần.
  Hạn công việc và sự kiện áp dụng dữ liệu sau khi lưu thành công. Nếu API lỗi, hạn,
  lịch hoặc thứ tự cũ được giữ, với thông báo nổi “Không lưu được, đã hoàn lại”.
  Ghim/bỏ ghim thủ công cũng tăng phiên bản thứ tự Ghi chú để Hoàn tác cũ không
  ghi đè thay đổi mới.
- Tôn trọng `prefers-reduced-motion`: bỏ chuyển động bay, rung và
  chuyển động; vẫn giữ màu/viền báo trạng thái.

Công việc cá nhân hiện chưa có dữ liệu SLA từ Workflows. Phần này không bổ sung
liên kết Workflows hay quy tắc khóa SLA; nguồn đang lưu được khóa bằng cơ chế
trạng thái bận và kiểm tra phiên bản sẵn có.

## Xác minh

Từ `frontend`, chạy `node tests/browser/drag-feedback-browser.cjs`. Bài kiểm tra dùng
tài khoản QA riêng và xóa dữ liệu của chính tài khoản đó sau khi xong. Kiểm tra
xem trước, nguồn mờ, kết quả thả, thả ngoài vùng, hiệu ứng thả, tô sáng hai nơi,
thông báo nổi, đổi tuần/hủy/Hoàn tác, nguồn rời màn hình, khối xem trước 15 phút, cuộn mép,
lỗi API và giảm chuyển động. Các bài hồi quy:

```text
node tests/browser/task-calendar-dnd-browser.cjs
node tests/browser/calendar-deadline-dnd-browser.cjs
node tests/browser/calendar-event-dnd-browser.cjs
node tests/browser/workspace-drag-browser.cjs
```

Ghi chú có hai SortableContext riêng cho đã ghim và chưa ghim. Thả ghi chú chưa ghim
sang nhóm ghim hoặc khoảng trống trong vùng Ghi chú đưa nó lên đầu nhóm chưa ghim;
ghi chú đã ghim thả ra ngoài nhóm ghim chuyển xuống cuối nhóm ghim, vẫn giữ trạng thái ghim. Ngoài tiện ích hoặc Escape hủy thao tác.
Vùng “Ghim lên đầu” vẫn tự ghim. Kéo Ghi chú không hiện nhãn kết quả hay thông báo nổi.

## Kéo giãn sự kiện có giờ

Khi kéo cạnh trên/dưới, chỉ vẽ khối xem trước tại lưới giờ, giữ `left`/`width` của làn nguồn
trong bản chụp trạng thái kéo. Khối gốc ẩn nhưng giữ chỗ, các khối khác giữ vị trí và kích thước và mờ 60%.
Không hiện lớp hiển thị nổi đi theo chuột, nhãn chú thích ở ô giờ hoặc chú thích gốc của trình duyệt của sự kiện.
Khối xem trước có một nhãn giờ bắt đầu–kết thúc, nền xanh đặc, viền đậm và vạch mốc 15 phút.
Tay cầm dưới chỉ hiện khi rê chuột hoặc chọn bằng bàn phím (hoặc màn hình cảm ứng). Vùng kéo cạnh trên
thu nhỏ để không đè lên tiêu đề; vẫn có thể dùng bàn phím chọn tay cầm để đổi giờ bắt đầu.
Hủy/lưu lỗi trả lại dữ liệu cũ; hoàn tác, chốt theo bước 15 phút và thời gian thực giữ nguyên.
Kiểm tra vị trí và kích thước: `node tests/browser/calendar-resize-visual-browser.cjs` từ giao diện.
