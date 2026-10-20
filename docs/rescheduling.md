# Đổi hạn và dời lịch cá nhân

Trong chi tiết công việc có nút **Đặt hạn/Đổi hạn**. Sự kiện và Notes đã gắn lịch có nút **Dời lịch**. Người xem lịch chia sẻ không có thao tác này.

Hộp thao tác dùng bộ chọn ngày/giờ chung; có Ngày mai, Tuần sau kèm ngày cụ thể, xem trước lịch cũ → mới, trường lý do tùy chọn tối đa 500 ký tự. Chọn thời điểm khác rồi xác nhận mới ghi dữ liệu. Chỉ nút X đóng hộp; bấm ngoài/Esc không đóng hộp nội dung. Bộ chọn ngày/giờ vẫn đóng theo cách cũ.

- To-Do giữ giờ cũ; có thể chuyển sang hạn cả ngày.
- Sự kiện và Notes giữ thời lượng khi đổi ngày/giờ bắt đầu; có thể sửa thời gian kết thúc hoặc chuyển sang cả ngày. Cả ngày dùng ngày kết thúc loại trừ theo hợp đồng API hiện có.
- Nội dung đang nhập trong hộp cha được giữ lại; thay đổi lịch không tự lưu phần nội dung đó.
- Thành công gửi thông tin cập nhật tới các widget, lịch chia sẻ theo quyền và tính lại nhắc hạn của Task. Toast Hoàn tác tự tắt sau 6 giây.

## Dữ liệu và API

Migration `scheduling_001_change_history` thêm bảng `schedule_changes`, không thay dữ liệu cũ. Mỗi thay đổi lịch lưu chủ tài khoản, tên người thực hiện, lịch cũ/mới, lý do, phiên bản sau đổi và thời điểm. Hoàn tác ghi `undone_at`. Không sao chép nội dung ghi chú/mô tả vào bảng này. Các form sửa thông thường vẫn dùng API cũ nhưng nay cùng ghi lịch sử qua service; không đổi ngày/giờ thì không tạo thêm lịch sử.

Migration `maintenance_001_retention_receipts` bảo toàn mã yêu cầu trước khi dọn lịch sử. Mặc định giữ lịch sử 365 ngày và job đã xử lý 30 ngày, dọn tối đa 500 dòng mỗi bảng mỗi đợt. Receipt chống gửi trùng không bị dọn cùng lịch sử. Cấu hình và số đo xem [dọn mã nguồn và tối ưu](cleanup-and-optimization-2026-10-20.md).

- `POST /api/schedule-changes/{task|event|note}/{id}`: kiểm tra chủ sở hữu, phiên bản và mã yêu cầu UUID; cập nhật lịch và lưu lịch sử trong cùng giao dịch. Gửi lại cùng mã/nội dung trả lại kết quả đã lưu, không đổi lịch lần hai.
- `GET /api/schedule-changes/{kind}/{id}`: chỉ chủ sở hữu, mặc định 20 lần gần nhất, tối đa 50. Một chỉ mục ghép theo chủ sở hữu/loại/mã mục/thời gian phục vụ truy vấn này. Không tải lịch sử khi chỉ mở lưới lịch hoặc danh sách widget.
- `POST /api/schedule-changes/records/{change_id}/undo`: chỉ chủ sở hữu; kiểm tra cả phiên bản và lịch sau đổi. Nếu đã sửa tiếp, trả 409. Gửi lại yêu cầu hoàn tác đã thành công không thực hiện lần hai.

Task dùng phiên bản số. Sự kiện dùng `updated_at`. Notes kiểm tra cả phiên bản ghi chú và phiên bản lịch hẹn. Lý do không được đưa vào API lịch chia sẻ và không được thêm vào nội dung/mô tả. Thao tác dùng lại dịch vụ cập nhật hiện có để giữ riêng tư, trạng thái hoàn thành và cập nhật các nhắc hạn.

Trước khi chạy migration trên môi trường đang có dữ liệu, sao lưu database theo quy trình triển khai. Bảng lịch sử được xóa theo tài khoản khi xóa tài khoản; xóa mục không chuyển lịch sử sang người khác.

## Kiểm thử

- Backend: `python -m unittest tests.integration.test_rescheduling`.
- Trình duyệt/PostgreSQL: `node tests/browser/rescheduling-browser.cjs`, dùng tài khoản tạm và tự dọn. Kiểm tra mất phản hồi, replay song song, giữ bản nháp, thời lượng, lịch sử/hoàn tác, quyền sở hữu, múi giờ trình duyệt và màn hình nhỏ.
