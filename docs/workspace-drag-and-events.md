# Kéo sự kiện và sắp xếp Workspace

## Sự kiện

Trong lịch Tuần, kéo thân sự kiện vào ô ngày/giờ để dời. Thả trong ô giờ được
chốt theo lưới 15 phút: 00, 15, 30, 45, gồm biên 00:00 ngày hôm sau.
Dời sự kiện giữ nguyên thời lượng khi giữ nguyên kiểu. Thả sự kiện theo giờ
vào Cả ngày làm tròn thời lượng lên số ngày; thả sự kiện cả ngày vào ô giờ
giữ độ dài khoảng và chuyển sang sự kiện có giờ.
Hai tay nắm ở cạnh trên/dưới đổi bắt đầu/kết thúc, thời lượng tối thiểu 15 phút.

Sự kiện cả ngày/nhiều ngày vẽ thành một thanh. Kéo thân thanh để dời cả khoảng,
kéo đầu trái/phải để đổi ngày bắt đầu/kết thúc. Ngày kết thúc vẫn là biên không
bao gồm: thả đầu phải vào Chủ nhật nghĩa là kết thúc lúc 00:00 thứ Hai.
Sự kiện cả ngày có thời lượng tối thiểu một ngày. Vùng Cả ngày có ưu tiên nhận
thả so với các ô giờ bị che phía sau khi cuộn.

Trong lịch Tháng, kéo sự kiện vào ngày khác để dời, giữ giờ và thời lượng.
Click ngắn vẫn mở chi tiết; kéo cạnh không mở form. Có preview giờ mới,
thông báo thành công và Hoàn tác. Chỉ cập nhật lịch, giữ tên, nội dung, địa điểm,
màu; kiểm tra updated_at để tránh ghi đè thay đổi mới hơn. Thời gian dùng UTC+7.

Mã frontend trong `features/calendar-dnd/`: tính khoảng thời gian,
provider theo dõi dnd-kit, các tay nắm và thanh nhiều ngày. Các vị trí thả dùng
chung với deadline, xử lý va chạm/bàn phím vẫn nằm trong `features/task-calendar/`.
API PATCH `/api/calendar/events/{id}/schedule` có schema riêng
`modules/calendar/interaction_schemas.py`; không cần thêm cột vào bảng sự kiện.

## Thứ tự và ghim

- Dùng tay nắm trên các thẻ Ứng dụng, Bookmarks, Notes để đổi thứ tự, tránh mở
  ứng dụng/liên kết/form ghi chú trong lúc kéo.
- Bookmarks, gồm cả liên kết chung, có thứ tự riêng theo người dùng; không đổi
  thứ tự mặc định của liên kết chung cho những người khác.
- Notes luôn đặt các note ghim trước note thường. Kéo vào vùng Ghim lên đầu
  vừa ghim vừa đưa note lên đầu, lưu trong một transaction. Nút Ghim/Bỏ ghim
  vẫn có thể dùng riêng; kéo thông thường thay thứ tự, không tự bỏ ghim.

Bảng mới `workspace_layouts` gồm khóa `(user_id, kind)`, `ordered_ids` JSON và
`version`. `kind` là apps/bookmarks/notes. Bảng được tạo bằng create_all hiện
có, có khóa ngoại xóa theo tài khoản. Không sửa hay xóa dữ liệu bảng cũ.
GET `/api/workspace/layout`, PUT `/api/workspace/layout/{kind}` kiểm tra quyền,
danh sách ID và expected_version. Xung đột trả 409, không ghi đè.

Frontend trong `features/workspace-layout/`: provider tải/lưu thứ tự và bộ
component sortable dùng dnd-kit/sortable. SSE truyền layout/notes/bookmarks
sau commit. Widget ghi chú và liên kết nghe topic tương ứng, cập nhật ngay ở
các phiên cùng người dùng. Lựa chọn có hiệu lực khi mở lại hoặc đổi thiết bị.

## Kiểm tra

Backend: `python -m unittest discover -s tests` từ thư mục backend.
Frontend: build Docker; `node tests/calendar-event-dnd-browser.cjs` và
`node tests/workspace-drag-browser.cjs` từ frontend. Hai bài mới tạo tài khoản QA
tạm có tên dragqa_, kiểm tra hai phiên độc lập và xóa chính các tài khoản đó
cùng dữ liệu của chúng sau khi xong; không thay thứ tự của tài khoản thật.

Phản hồi và Hoàn tác chung: [drag-feedback.md](drag-feedback.md).
