# Rà soát mã nguồn ngày 20/10/2026

Cập nhật sau rà soát: các mục lịch sử/Hoàn tác, phạm vi tải lại, NOTIFY theo lô, Notes, lưu giữ dữ liệu và dọn tài nguyên đã được xử lý theo [báo cáo triển khai](cleanup-and-optimization-2026-10-20.md). Nội dung dưới đây giữ lại bằng chứng tại thời điểm rà soát; các mục bảo mật/SSO chưa thuộc đợt xử lý này.

Phạm vi: mã nguồn backend/frontend, cấu hình Docker, các luồng To-Do/Calendar/Notes/thông báo/quyền và dời lịch vừa bổ sung. Lần rà soát này không thay đổi mã chạy ứng dụng hoặc xóa dữ liệu.

Đã qua kiểm tra TypeScript với `noUnusedLocals`/`noUnusedParameters`, kiểm tra khoảng trắng Git, 99 kiểm thử tích hợp backend và 40 kiểm thử frontend. Các kiểm thử qua không đồng nghĩa đã kiểm chứng tải production. Chưa đo EXPLAIN với dữ liệu lớn hoặc kiểm tra hạ tầng bên ngoài repo.

## P0 — Trước khi triển khai production

1. **Khóa ký token và mật khẩu mẫu nằm trong cấu hình.** `docker-compose.yml` đặt khóa ký cố định dù `APP_ENV=production`; `core/config.py` có giá trị mặc định. `app/main.py` luôn gọi seed và tạo admin bằng mật khẩu mẫu nếu chưa có tài khoản. Chuyển secret sang cấu hình triển khai, chặn khởi động production nếu dùng giá trị mẫu; tách bootstrap admin và dữ liệu demo khỏi khởi động thông thường. Nếu đã dùng khóa mẫu trên môi trường công khai, cần thay khóa và vô hiệu hóa phiên cũ.
2. **Docker hiện là cấu hình phát triển.** Frontend chạy `npm install` rồi Vite dev server và bind mount source. Database và Redis mở cổng host. Cần cấu hình production riêng phục vụ bản build, hạn chế cổng và tài khoản database; không coi compose hiện tại là cấu hình production hoàn chỉnh.

## P1 — Bảo mật và tính đúng đắn

3. **SSO chưa kiểm tra `allowed_apps`, ticket chưa bảo đảm dùng một lần.** `modules/sso/router.py` phát ticket cho mọi target hợp lệ. `core/security.py` chỉ kiểm chữ ký/hạn/target; `jti` chưa được đánh dấu đã dùng. Probe API SQLite cô lập: tài khoản `allowed_apps=''` vẫn nhận HTTP 200 khi mở Workflows. Cùng ticket được xác thực thành công hai lần. Khi dùng quyền ứng dụng để chặn truy cập, phải kiểm ở backend; bổ sung cơ chế tiêu thụ ticket nguyên tử và kiểm tra tại ứng dụng nhận.
4. **Đăng xuất/đổi mật khẩu chưa thu hồi JWT cũ.** Logout trả 204, đổi mật khẩu chỉ đổi hash. Token còn hạn vẫn có thể được sử dụng. Cần phiên/token version hoặc cơ chế thu hồi phù hợp. Trong backend chưa thấy giới hạn tần suất đăng nhập; PBKDF2 đang chạy đồng bộ ngay trong endpoint async, có thể chặn vòng lặp xử lý khi nhiều lượt đăng nhập cùng lúc. Chưa kiểm tra rate limit tại proxy bên ngoài repo.
5. **Lịch sử đổi lịch chưa bao phủ form sửa thông thường.** Chỉ API `schedule-changes` lưu lịch sử; PATCH Task/Notes và PUT Event cũ vẫn đổi ngày giờ mà không tạo bản ghi lịch sử. Probe: hai lần đổi hạn, trong đó một lần dùng PATCH cũ, chỉ có một dòng lịch sử và ngày cuối trong lịch sử khác dữ liệu hiện tại. Nếu lịch sử phải phản ánh mọi lần đổi lịch, cần gom nghiệp vụ đổi lịch vào service dùng chung và lưu lịch sử trong cùng giao dịch, không ghi hai lần khi đi qua endpoint mới.
6. **Phản hồi Hoàn tác cũ có thể xóa toast mới.** `RescheduleToast.tsx` gọi `setChange(undefined)` sau mỗi lần undo hoàn tất, chưa kiểm tra ID của toast đang hiển thị. Đã tái hiện bằng cổng đồng bộ: giữ phản hồi undo A, phát toast B, trả phản hồi A; toast B biến mất trước 6 giây. Cần ràng buộc kết quả async với mã thao tác; bổ sung kiểm thử điều phối phản hồi thay vì dựa vào thời gian ngủ.

## P2 — Hiệu năng, database và tổ chức code

7. **Dời Sự kiện thường vẫn làm Notes tải lại từ frontend.** `features/rescheduling/api.ts:notifyMoved` phát cả `notes` và `calendar` cho mọi loại không phải Task. Backend đã tránh báo Notes khi sự kiện không liên quan, nhưng frontend phát lại phạm vi quá rộng. Với `kind=event` chỉ cần `calendar`; với `kind=note` mới cần cả hai.
8. **Fan-out realtime còn một lệnh SQL cho mỗi người nhận.** `core/realtime.py:prepare_changes` gọi `pg_notify` trong vòng lặp. Đây là số lượt SQL tăng theo người nhận, khác với N+1 đọc từng Note/Task. Nên gộp các payload theo lô trong cùng giao dịch; không bỏ kiểm tra phạm vi chia sẻ.
9. **Widget Notes có 6 truy vấn nghiệp vụ cố định khi có dữ liệu.** Đếm tổng, đếm nhóm, lấy ID ghim, ID chưa ghim, nội dung xem trước và lịch hẹn. Không phải N+1 theo số thẻ. Có thể gộp đếm và lấy trực tiếp preview trong truy vấn chọn từng nhóm; cần đo trước/sau vì truy vấn gộp chưa chắc nhanh hơn.
10. **Lịch sử/job/receipt chưa có chính sách lưu giữ.** `schedule_changes` dùng liên kết tài nguyên theo loại/mã, nên xóa mục không tự xóa lịch sử của mục; worker giữ job đã xử lý. Cần chốt thời hạn lưu và cơ chế dọn theo lô. Không được xóa receipt chống tạo trùng khi chưa xác định thời hạn thử lại và hành vi với request cũ.
11. **Module dời lịch đang gọi trực tiếp hàm route của ba module khác.** `modules/rescheduling/router.py` nhập `update_task`, `update_note`, `update_event` từ router. Nên tách service nghiệp vụ có kiểm tra phiên bản, rồi để cả route cũ/mới cùng gọi. Việc này cũng giúp xử lý mục 5 và giảm truy vấn/khóa lặp.
12. **Ảnh logo lớn so với kích thước hiển thị.** Logo PNG khoảng 550 KB nhưng trên thanh menu cao khoảng 62 px. Có thể tạo biến thể kích thước phù hợp với màn hình thường/Retina và giữ alpha; giữ bản gốc chất lượng cao làm nguồn.

## Phần có thể dọn

- Import không dùng: `Base` trong `app/main.py`, `select` trong `core/workspace_versions.py`, `JSON` trong `db/models.py`, `Field` trong `modules/note_scheduling/schemas.py`, `Query` trong `modules/sso/router.py`.
- `.modal-overlay` trong `frontend/src/index.css` không còn tham chiếu trong source hiện tại, sau khi dùng native dialog.
- Các bản icon trong `frontend/public/icon-*.png` không được source hiện tại sử dụng; icon đang nhập từ `src/assets`. `public/dong-tay-land-logo.png` và `src/assets/dong-tay-land-logo.png` là các bản trùng `public/logo.png`. Kiểm tra liên kết tĩnh từ bên ngoài repo trước khi xóa public URL. `public/logo.png` vẫn được trang đăng nhập sử dụng, cần giữ.
- Package Python `redis` và service `platform-redis` chưa được mã ứng dụng sử dụng. Có thể bỏ khỏi cấu hình mặc định hoặc chuyển sang profile tùy chọn; không cần chạy Redis chỉ để giữ chỗ cho tương lai.
- Các API danh sách cũ của Task/Notes/Event và nhắc hạn cũ không phải luồng chính của frontend hiện tại. Chỉ loại bỏ sau khi kiểm tra hợp đồng tích hợp và test. Không coi mọi endpoint không được UI gọi là có thể xóa ngay.

Không phát hiện file TypeScript thuộc `src` không thể đi tới từ cây import `main.tsx`. Các import model trong migration runner dùng để đăng ký metadata; công cụ đếm tên có thể báo nhầm là import thừa, không được xóa máy móc.

## Những phần cần giữ

- `workspace_versions` phục vụ đồng bộ SSE, không phải cấu hình kéo thả đã gỡ.
- `task_reminder_receipts` vẫn được worker thông báo đọc.
- Migration cũ phục vụ nâng cấp dữ liệu, không xóa theo việc giao diện cũ đã biến mất.
- `legacy_due_date` vẫn có nhánh hiển thị để xử lý hạn cũ chưa chuyển đổi được.
- Các truy vấn đếm Task vẫn phục vụ bộ lọc, phân trang và thống kê. Bỏ số trên nút “Xem tất cả” chỉ bỏ phụ thuộc của nhãn nút, không đồng nghĩa có thể xóa toàn bộ truy vấn đếm.

Các luồng đọc chính đã kiểm tra không có bằng chứng N+1 ORM theo từng thẻ. Đã có phân trang, preview Notes cắt ở SQL, giới hạn dữ liệu lịch, phiên bản ghi, request ID và cấu hình pool/timeout. Không nên thêm chỉ mục hoặc chuyển Redis chỉ dựa trên số lượng tài khoản, khi chưa có số đo truy vấn và tải đồng thời.

Thứ tự thực hiện đề xuất: P0 và quyền SSO → tính đúng đắn của lịch sử/Hoàn tác → phạm vi tải lại và service dùng chung → gộp truy vấn sau khi đo → dọn import/CSS/ảnh/dependency có bằng chứng không dùng.
