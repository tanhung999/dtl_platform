# Kiểm thử tải 500 người dùng

Kịch bản `platform-500-users.js` tăng dần đến 500 người dùng, giữ tải trong 5 phút và kiểm tra đăng nhập, phiên làm việc và danh sách ứng dụng được cấp quyền.

Mặc định kịch bản đăng nhập một lần rồi dùng chung phiên để đo 500 người dùng **đang hoạt động**, tránh biến bài kiểm tra thành 500 lần băm mật khẩu đồng thời. Để kiểm tra riêng năng lực đăng nhập, đặt `LOGIN_PER_VU=true` và tăng thời gian ramp-up tối thiểu 5 phút.

Chạy trên môi trường staging/production-like, không chạy trên dữ liệu production. Tạo riêng một tài khoản kiểm thử đã được cấp quyền đăng nhập, sau đó chạy:

```powershell
$env:BASE_URL = "https://platform-staging.example.com"
$env:LOAD_TEST_USERNAME = "loadtest"
$env:LOAD_TEST_PASSWORD = "<password>"
docker run --rm -i `
  -v "${PWD}\load-tests:/scripts:ro" `
  -e BASE_URL -e LOAD_TEST_USERNAME -e LOAD_TEST_PASSWORD `
  -e LOGIN_PER_VU=false `
  -e RAMP_UP=2m -e HOLD=5m -e RAMP_DOWN=1m `
  grafana/k6 run /scripts/platform-500-users.js
```

Điều kiện đạt:

- Tỷ lệ lỗi HTTP dưới 1%.
- P95 dưới 1 giây và P99 dưới 2 giây.
- P95 đăng nhập dưới 2 giây.
- Tỷ lệ kiểm tra nghiệp vụ thất bại dưới 1%.

Mỗi VU đăng nhập một lần và giữ cookie riêng. Sau đợt thử, để tác vụ bảo trì phiên hết hạn dọn dữ liệu hoặc xóa riêng các phiên của tài khoản kiểm thử.
