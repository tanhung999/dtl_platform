# Chia sẻ lịch chỉ xem

## Cách dùng

1. Tài khoản quản trị khởi tạo `admin` mở **Quản trị → Phân quyền**, tìm/lọc tài khoản trong danh sách có phân trang và bấm **Cho phép chia sẻ lịch**.
2. Tài khoản vừa được cấp quyền thấy nút **Chia sẻ lịch** trong sidebar Lịch. Tìm người nhận, chọn phạm vi và xác nhận.
3. Mặc định chỉ bật **Sự kiện**. **Việc cần làm** và **Ghi chú** phải được chọn riêng; bắt buộc có ít nhất một mục.
4. Người nhận thấy mục **Được chia sẻ với tôi**, mở từng lịch ở chế độ **Chỉ xem**. Có Tuần/Tháng/Danh sách; không kéo thả, sửa, xóa hay tick công việc.
5. Chủ lịch sửa phạm vi hoặc thu hồi trong hộp Chia sẻ lịch. Thu hồi khả năng chia sẻ cũng vô hiệu hóa toàn bộ quyền xem do tài khoản đó cấp. Cấp lại không tự khôi phục các người xem cũ.

## Phạm vi và riêng tư

- Sự kiện: chỉ các sự kiện thông thường. Công tắc **Riêng tư** mặc định tắt khi tạo mới, giữ giá trị khi sửa. Bật công tắc sẽ ẩn hoàn toàn mục đó với người xem, bao gồm số đếm và API chi tiết.
- Việc cần làm: chỉ công việc có hạn trong khoảng đang xem; việc không hạn và danh sách To-Do đầy đủ không được chia sẻ.
- Ghi chú: chỉ ghi chú gắn vào lịch, gồm nội dung khi mở chi tiết. Không cấp quyền xem toàn bộ kho Notes. Ghi chú vẫn có giao diện note và giữ màu người dùng chọn.
- Quyền chia sẻ chỉ áp dụng cho lịch của chính người cấp, không có chuyển tiếp quyền.
- Quản trị quyền không mặc nhiên được đọc dữ liệu lịch. Vai trò dạng chữ trên hồ sơ không quyết định quyền truy cập.

## Cấu trúc

- `backend/app/db/access.py`: vai trò, quyền, ánh xạ và quyền xem lịch.
- `backend/app/modules/access`: kiểm tra quyền và cấp khả năng chia sẻ.
- `backend/app/modules/calendar_sharing`: quản lý người xem, danh sách và chi tiết chỉ đọc.
- `frontend/src/features/access`: API quyền, tìm tài khoản và giao diện cấp/thu hồi quyền.
- `frontend/src/features/admin`: trang quản trị, mở từ mục **Quản trị** bên phải **Profile** trên thanh điều hướng; chỉ tài khoản có quyền quản lý mới thấy.
- `frontend/src/features/calendar-sharing`: sidebar, hộp chia sẻ và điều phối lịch chỉ xem.
- `frontend/src/features/calendar-sharing/components`: các phần Tuần, Tháng/Danh sách, thẻ lịch và chi tiết chỉ đọc.
- `frontend/src/features/calendar-sharing/hooks`: tải ngầm, đối soát quyền và cập nhật chi tiết.
- Migration `access_001_readonly_calendar_sharing`: thêm `calendar_events.is_private`, tạo bảng mới và khởi tạo danh mục quyền.

Lõi quyền gồm `access_roles`, `access_permissions`, `access_role_permissions`, `access_user_roles`. Hai quyền hiện dùng là `access.assignments.manage` và `calendar.share.manage`. Có thể bổ sung quyền ứng dụng sau; phiên bản này chưa chặn truy cập tại ba ứng dụng doanh nghiệp.

Migration chỉ cấp vai trò quản lý quyền cho tài khoản `admin` hiện có một lần để khởi tạo hệ thống. Không tự cấp quyền chia sẻ cho tài khoản này hoặc các tài khoản có chức danh tổng giám đốc. Khi tạo mới bộ dữ liệu khởi tạo, tài khoản `admin` nhận cùng vai trò quản lý quyền. Quản trị viên cần cấp quyền chia sẻ cụ thể qua giao diện.

## Đồng bộ và giới hạn

- Kiểm tra quyền từ database trên mỗi yêu cầu; không tin quyền lưu trong trình duyệt/JWT.
- SSE dùng cùng kết nối hiện tại, chỉ phát tín hiệu vô hiệu hóa dữ liệu, không phát nội dung. Thay đổi nhiều mục chỉ dùng một truy vấn tìm người nhận cập nhật.
- Cập nhật thông thường tải ngầm, giữ vị trí cuộn và hộp chi tiết. Thay đổi quyền hoặc riêng tư che nội dung trong lúc kiểm tra; chỉ đóng chi tiết nếu mục đã bị xóa, chuyển riêng tư hoặc mất quyền. Kiểm tra lại quyền khi quay lại tab/kết nối lại. Thu hồi không thể xóa dữ liệu đã được người nhận sao chép hoặc chụp trước đó.
- Khoảng xem tối đa 93 ngày, trả tối đa 500 mục và cờ còn dữ liệu. Truy vấn có giới hạn; không gọi riêng từng mục. Nội dung dài chỉ tải khi mở chi tiết.
- Tối đa 200 người xem/lịch. Tìm tài khoản từ 2 ký tự, chờ 300 ms sau khi gõ và trả tối đa 20 kết quả.
- Thay đổi quyền xem kiểm tra phiên bản; thu hồi kiểm tra cả mã quyền xem để không xóa nhầm một quyền mới được cấp lại. Thử lại thao tác chia sẻ với cùng phiên bản/phạm vi trả kết quả đã lưu, không tạo thêm thông báo.
- Người được chia sẻ nhận thông báo lưu trong tài khoản; bấm thông báo kiểm tra lại quyền rồi mở lịch tương ứng.

## Kiểm tra

- `backend/tests/integration/test_calendar_sharing.py`: quyền, riêng tư, phạm vi, chỉ đọc, phiên bản, thu hồi, thông báo và tín hiệu realtime.
- `frontend/tests/browser/calendar-sharing-browser.cjs`: luồng quản trị → chủ lịch → người xem trên các tài khoản thử nghiệm độc lập.
- Chưa đo tải đồng thời của chức năng chia sẻ trên môi trường production.

## Hoàn thiện độ tin cậy và giao diện

- Migration `access_002_sharing_reliability_audit` thêm `calendar_shares.revoked_at`, bảng phiên bản phân quyền `access_account_versions` và nhật ký `access_audit_logs`.
- Quyền xem đã thu hồi được giữ như một trạng thái không hoạt động, không dùng để đọc lịch. Phiên bản tiếp tục tăng; gửi lại yêu cầu tạo cũ bị từ chối. Muốn cấp lại, chủ lịch chọn người nhận, đọc trạng thái mới rồi xác nhận Chia sẻ. Các phạm vi mới mặc định chỉ bật Sự kiện.
- Cấp/thu hồi khả năng chia sẻ kiểm tra cả phiên bản và trạng thái cũ. Thử lại đúng một thao tác đã lưu trả kết quả hiện tại, không ghi thêm nhật ký.
- Nhật ký ghi người thao tác, người nhận, hành động, phạm vi trước/sau và thời gian; không ghi nội dung sự kiện, công việc hay ghi chú. Chỉ người có quyền quản trị phân quyền được đọc nhật ký. Lịch sử bắt đầu từ phiên bản này; không tự dựng lại lịch sử cũ.
- Trang Quản trị có danh sách 20 tài khoản/trang, tìm kiếm phía máy chủ, bộ lọc đã/chưa được cấp quyền và lịch sử có phân trang bằng mốc thời gian/mã bản ghi.
- Lịch được chia sẻ hỗ trợ công tắc Hiện khung giờ đêm và lời nhắc nếu có mục trước 06:00. Chi tiết luôn ghi đầy đủ khoảng ngày/giờ, bao gồm quy tắc ngày kết thúc loại trừ cho mục cả ngày.
- Sự kiện cả ngày nhiều ngày dùng thanh liên tục, có mũi tên nếu vượt khỏi tuần. Deadline có giờ là thẻ mốc cao 24px, dùng cùng màu ưu tiên To-Do; không phải sự kiện có thời lượng.
- Giữ sidebar chuyển lịch/chia sẻ trên màn hình nhỏ. Chỉ cho chia sẻ từ lịch của chính mình; trang xem lịch người khác không có thao tác ghi.
- Tất cả mục được chuẩn hóa về một mốc thời gian khi sắp xếp và trước khi giới hạn 500 kết quả. Deadline không giờ đứng ở đầu ngày; dữ liệu bị giới hạn luôn có thông báo.

Kiểm thử bổ sung: chống tạo lại sau thu hồi, kiểm tra phiên bản qua nhiều lần cấp/thu hồi, nhật ký/phân trang và quyền quản trị, thứ tự UTC/giờ Việt Nam, cửa sổ giờ đêm, thanh nhiều ngày, khoảng thời gian đầy đủ, giữ hộp chi tiết/vị trí cuộn khi cập nhật, đóng khi mất quyền, cấp lại có chủ ý và phân biệt ghi chú với sự kiện.

Việc quá hạn trong khoảng đang xem được gom vào khung riêng và không lặp lại trên lưới. Công việc đã hoàn thành vẫn nằm trên lịch. Bài đo tải đọc lịch chia sẻ cục bộ: `node tests/load/calendar-sharing-load.cjs` (300 tài khoản tạm, 200 yêu cầu đọc đồng thời, tự dọn; không đo tải đăng nhập hoặc tải ghi).

Khi xóa ghi chú đã gắn lịch, lịch hẹn được giữ theo luồng cũ nhưng chuyển thành sự kiện riêng tư. Nó không tự xuất hiện với người chỉ được chia sẻ Sự kiện. Hộp xác nhận xóa nêu rõ hành vi này. Đổi tiêu đề ghi chú bằng yêu cầu cập nhật một phần cũng đồng bộ tiêu đề trên lịch.

## Kết quả đo đọc trên Docker cục bộ

Đã thử 300 tài khoản tạm, 200 người xem gửi yêu cầu đồng thời vào một lịch gồm 25 mục công khai (10 sự kiện, 10 deadline, 5 ghi chú) và các sự kiện riêng tư bị loại khỏi kết quả. Cả 200 yêu cầu trả đúng dữ liệu, tài khoản ngoài danh sách bị chặn. Sau khi gộp số đếm vào truy vấn danh sách bằng hàm cửa sổ, lần đo lại có P95 khoảng 1,6 giây (lần đo trước khoảng 4,7 giây).

Đây là phép đo một đợt đọc trên máy cục bộ, không phải cam kết năng lực production; chưa đo đăng nhập đồng loạt, tải ghi hỗn hợp hoặc 200 kết nối SSE trong bài đo riêng này.

Thao tác cấp quyền, chia sẻ và thu hồi dùng cùng cơ chế thời gian chờ/đối soát như Tasks và Calendar: khi mất phản hồi sẽ đọc đúng trạng thái của tài khoản hoặc cặp chia sẻ, kiểm tra phiên bản và phạm vi; không tải toàn bộ danh sách để đoán kết quả.
