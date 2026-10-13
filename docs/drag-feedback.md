# Phản hồi khi kéo thả

Phần dùng chung nằm trong `frontend/src/features/drag-feedback/`, nối với
`task-calendar`, `calendar-dnd` và `workspace-layout` qua provider của dnd-kit.
Không thêm bảng hay cột database cho hiệu ứng.

- Tay nắm dùng grab; đang kéo dùng grabbing. Mục gốc mờ 40% và có viền nét đứt.
  Bản sao chỉ giữ tên, ưu tiên và hạn (hoặc tên và giờ sự kiện), nghiêng 2 độ,
  thu còn 95%, có bóng đổ. Thẻ sortable chỉ giữ tên.
- Ô ngày và ô giờ hợp lệ có nền xanh nhạt. Ô đang rê có viền xanh đậm,
  nhãn nói trước ngày, giờ được giữ hay giờ bị bỏ khi chuyển sang cả ngày.
  Deadline trên lưới có ghost cao 24px, chốt theo bước 15 phút.
- Ngoài vùng thả: con trỏ cấm, bản sao mờ và viền đỏ nhạt. Thả ngoài vùng hoặc
  Escape cho bản sao quay về trong 200ms, rung nhẹ nguồn, không gửi API.
- Vùng giờ tự cuộn khi giữ ở mép khoảng 180ms; mép có gradient.
  Giữ sát trái/phải 700ms để đổi tuần. Lưới có thể cuộn ngang trước khi đổi tuần.
  Hủy, lỗi lưu hoặc Hoàn tác khôi phục tuần ban đầu nếu đã đổi tuần khi kéo.
  Kéo ở giữa ô Chủ nhật không đổi tuần.
- Thả hợp lệ có hiệu ứng 180ms và nháy viền đích. Sau API thành công, mục vừa
  đổi sáng vàng rồi mờ trong 3 giây ở To-Do và Lịch. Danh sách chuyển vị trí
  trong 180ms; số đếm có chuyển động nhẹ và dùng dữ liệu realtime hiện có.
- Toast ở góc dưới phải, tự đóng khoảng 6 giây; rê chuột/focus/tác vụ lưu
  tạm dừng. Chỉ hiện một toast kéo thả tại một thời điểm. Hoàn tác có kiểm tra
  phiên bản, bao gồm khôi phục trạng thái ghim Notes trước khi kéo.
- Chỉ áp dụng thay đổi dữ liệu sau khi lưu thành công. Nếu API lỗi, hạn,
  lịch hoặc thứ tự cũ được giữ, với toast “Không lưu được, đã hoàn lại”.
  Ghim/bỏ ghim thủ công cũng tăng phiên bản thứ tự Notes để Hoàn tác cũ không
  ghi đè thay đổi mới.
- Tôn trọng `prefers-reduced-motion`: bỏ chuyển động bay, rung, nghiêng và
  animation; vẫn giữ màu/viền báo trạng thái.

Task cá nhân hiện chưa có dữ liệu SLA từ Workflows. Phần này không bổ sung
liên kết Workflows hay quy tắc khóa SLA; nguồn đang lưu được khóa bằng cơ chế
busy và kiểm tra phiên bản sẵn có.

## Xác minh

Từ `frontend`, chạy `node tests/drag-feedback-browser.cjs`. Bài kiểm tra dùng
tài khoản QA riêng và xóa dữ liệu của chính tài khoản đó sau khi xong. Kiểm tra
preview, nguồn mờ, kết quả thả, thả ngoài vùng, hiệu ứng thả, tô sáng hai nơi,
toast, đổi tuần/hủy/Hoàn tác, nguồn rời màn hình, ghost 15 phút, cuộn mép,
lỗi API và giảm chuyển động. Các bài hồi quy:

```text
node tests/task-calendar-dnd-browser.cjs
node tests/calendar-deadline-dnd-browser.cjs
node tests/calendar-event-dnd-browser.cjs
node tests/workspace-drag-browser.cjs
```
