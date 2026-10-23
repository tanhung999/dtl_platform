# Lưu khi dữ liệu không thay đổi

- Form sửa Công việc, Sự kiện và Ghi chú đóng ngay khi các trường nhập khớp bản đang sửa; không gọi API lưu, không làm mới danh sách.
- Hồ sơ giữ nguyên trang và báo “Thông tin chưa thay đổi.”. Sửa phạm vi chia sẻ đóng phần chọn người xem nếu các phạm vi giữ nguyên. Thao tác cấp/thu hồi quyền luôn là thay đổi thực sự.
- So sánh theo giá trị dùng để lưu: tiêu đề đã chuẩn hóa, mô tả Task rỗng tương đương `null`, thời điểm lịch hẹn theo cùng một thời điểm UTC. Sửa rồi trả về giá trị ban đầu được coi là không thay đổi.
- Với Sự kiện, giữ giây và phần lẻ của thời điểm gốc nếu người dùng không sửa ngày/giờ tương ứng. Dời lịch và Hoàn tác cập nhật mốc ngày giờ đang lưu để nút Lưu sau đó không gửi lại lịch cũ.
- Ghi chú tải bản mới cập nhật lại mốc so sánh nội dung. Lưu không thay đổi không cắt khoảng trắng khỏi nội dung gốc trong database.

Backend vẫn kiểm tra đăng nhập, quyền sở hữu và phiên bản trước khi bỏ qua ghi. Phiên bản cũ trả `409` kể cả khi nội dung gửi lên khớp dữ liệu mới. Nếu hợp lệ và dữ liệu giống hệt, trả bản hiện tại, giữ `version`/`updated_at`, không tạo lịch sử, job nhắc hạn hay sự kiện realtime.

Ghi chú có lịch hẹn vẫn kiểm tra phiên bản sự kiện liên kết. Đổi riêng nội dung ghi chú không cập nhật lại thời điểm của sự kiện nếu lịch hẹn, tên và riêng tư không đổi. Cài đặt thông báo cũng giữ phiên bản khi nhận lại cùng giá trị, kể cả khi đang dùng cài đặt mặc định chưa có bản ghi riêng.

Đối soát khi mất phản hồi chấp nhận dữ liệu khớp ở cùng phiên bản hoặc phiên bản mới hơn. Không cần tăng phiên bản để xác nhận một yêu cầu không làm thay đổi dữ liệu.

Kiểm tra:

- Backend: `tests/integration/test_unchanged_updates.py` kiểm tra trực tiếp không có SQL `INSERT/UPDATE/DELETE`, phiên bản cũ, quyền sở hữu, lịch hẹn cũ và cài đặt mặc định.
- Trình duyệt: `tests/browser/unchanged-save-browser.cjs` kiểm tra không phát request ghi ở Task/Note/Event/Profile, sửa rồi hoàn nguyên, và sửa nội dung sự kiện giữ giây gốc.
