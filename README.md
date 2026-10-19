# DTL Platform — Cổng làm việc số và đăng nhập một lần

Cổng làm việc tập trung cho cán bộ nhân viên **Đông Tây Land**, kết nối đăng nhập một lần (SSO) tới Booking Reports, Workflows và Asset Manager. Không gian cá nhân gồm Ghi chú, Công việc, Liên kết, Lịch cá nhân và Thông báo.

## Kiến trúc và công nghệ

- Giao diện: React 18, TypeScript, Vite, biểu tượng Lucide React; CSS hỗ trợ sáng/tối và nhiều kích thước màn hình. Kéo thả dùng dnd-kit.
- Máy chủ: FastAPI, Python, SQLAlchemy bất đồng bộ.
- Cơ sở dữ liệu: SQLite cho phát triển cục bộ; PostgreSQL cho môi trường vận hành. PostgreSQL LISTEN/NOTIFY kết hợp SSE chuyển cập nhật giữa các phiên và tiến trình.
- Phiên đăng nhập/vé SSO dùng JWT với PyJWT. Mật khẩu được băm PBKDF2-HMAC-SHA256.
- Mỗi chức năng quản lý API tại `features/<feature>/api.ts`; phần HTTP, thời gian chờ và đối soát thao tác nằm trong `services/`.

## Khởi chạy trực tiếp bằng Python và Node.js

Từ thư mục dự án, tạo môi trường máy chủ:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Trên Linux/macOS, kích hoạt môi trường bằng `source .venv/bin/activate` thay cho lệnh Windows. Có thể đặt cấu hình tại `backend/.env`, tham khảo `.env.example` ở thư mục gốc. Nếu không đổi cấu hình, máy chủ dùng SQLite `platform.db` trong thư mục chạy.

Lần khởi động đầu tạo dữ liệu mẫu nếu chưa có quản trị viên:

- Tên đăng nhập: `admin`.
- Mật khẩu: `admin123`.

Xem tài liệu API tại `http://localhost:8000/docs`.

Mở cửa sổ lệnh khác để chạy giao diện:

```powershell
cd frontend
npm install
npm run dev
```

Truy cập `http://localhost:5173`.

## Khởi chạy bằng Docker Compose

Từ thư mục gốc:

```sh
docker compose up -d --build
```

- Giao diện: `http://localhost:5173`.
- API: `http://localhost:8000`.
- PostgreSQL lưu dữ liệu trong volume `platform_db_data`.
- Mã giao diện được gắn trực tiếp vào container; mã máy chủ được sao chép khi dựng image. Sau khi sửa mã máy chủ, cần dựng lại:

```sh
docker compose up -d --build platform-backend
```

## Đăng nhập một lần vào ứng dụng doanh nghiệp

1. Người dùng bấm thẻ Booking Reports, Workflows hoặc Asset Manager.
2. Giao diện gọi POST `/api/sso/launch` với `target_app`.
3. Máy chủ ký vé JWT bằng `SSO_SECRET_KEY`, mặc định có hiệu lực 60 giây, trả `launch_url`.
4. Trình duyệt mở `/sso-callback?ticket=...` của ứng dụng đích.
5. Ứng dụng đích xác thực vé, đối chiếu tài khoản và tạo phiên nội bộ, rồi đưa người dùng vào ứng dụng.

Ứng dụng đích có thể gọi POST `/api/sso/verify` để đối soát tập trung. Cần cấu hình đúng địa chỉ `BOOKING_REPORTS_URL`, `WORKFLOWS_URL`, `ASSET_MANAGER_URL` và triển khai phần nhận vé ở từng hệ thống. Luồng chi tiết và cách cấp phiên phải đối chiếu với mã nguồn của ứng dụng đích.

## Phần tích hợp phía các ứng dụng doanh nghiệp

Các mục dưới đây là phần việc tại hệ thống bên ngoài, không phải xác nhận rằng ba ứng dụng đã được kết nối đầy đủ trong kho mã này.

- Booking Reports: bổ sung POST `/api/auth/sso-login`, xác thực vé, tìm tài khoản theo email/tên đăng nhập và cấp phiên bằng luồng hiện có; trang `/sso-callback` nhận vé, gọi API rồi chuyển vào ứng dụng. Các hàm cấp phiên như `issue_refresh_token` và `auth_response` cần đối chiếu với dự án đích.
- Workflows: bổ sung API nhận vé, tìm tài khoản theo thông tin đã xác thực, tạo phiên theo `auth_sessions`/`TokenResponse` của hệ thống; trang `/sso-callback` gọi API đăng nhập.
- Asset Manager: bổ sung API nhận vé, ánh xạ tài khoản và tạo phiên theo cơ chế của ứng dụng; trang `/sso-callback` chuyển vào màn hình chính.
- Thông báo: Platform đã có API tiếp nhận có chữ ký riêng cho từng nguồn. Phía ứng dụng cần gửi sự kiện và ánh xạ đúng ID người nhận. Xem [tài liệu Thông báo](docs/notifications.md). Hiện chưa xác nhận kết nối thực tế hoặc mở thẳng vào hồ sơ của ba ứng dụng.

## Chức năng và tài liệu

- [Lịch cá nhân](docs/calendar.md): xem tuần/tháng/danh sách, tạo/sửa/xóa sự kiện, kéo dời và co giãn.
- [Đồng bộ công việc với lịch](docs/task-deadlines.md): hạn, hoàn thành hai chiều và hiển thị quá hạn.
- [Đặt lịch cho ghi chú](docs/note-scheduling.md): lịch hẹn riêng, ngày giờ dùng chung, lưu nguyên tử và cập nhật tức thời.
- [Thông báo](docs/notifications.md): chuông, lịch sử, đọc/ẩn, nhắc hạn ở máy chủ và hợp đồng tích hợp.
- [Bố cục tiện ích](docs/dashboard-widget-layout.md) và [sắp xếp các mục](docs/workspace-drag-and-events.md).
- [Phản hồi khi kéo thả](docs/drag-feedback.md).
- [Phân trang và phục hồi kết nối](docs/calendar-tasks-notes-scaling.md).
- [Đo tải 300 tài khoản, 200 phiên](docs/collections-capacity-300.md).
- [Quy ước cấu trúc mã nguồn](docs/project-structure.md).

Ghi chú có định dạng phong phú và số đếm nghiệp vụ ngay trên từng thẻ ứng dụng là các hướng mở rộng riêng, không được coi là đã hoàn thành chỉ vì có mô-đun Thông báo.

## Cấu trúc thư mục

```text
dtl-platform/
├── backend/
│   ├── app/
│   │   ├── core/          # Cấu hình, cơ sở dữ liệu, bảo mật, cập nhật thời gian thực
│   │   ├── db/            # Mô hình dữ liệu và các bản nâng cấp
│   │   ├── modules/       # Xác thực, SSO, công việc, lịch, ghi chú, thông báo...
│   │   └── main.py        # Khởi tạo ứng dụng và vòng đời máy chủ
│   └── tests/
│       ├── integration/  # Kiểm thử tích hợp trên SQLite cô lập
│       ├── postgres/     # Kiểm tra riêng PostgreSQL
│       └── support/      # Dữ liệu và tiện ích kiểm thử dùng chung
├── frontend/
│   ├── src/
│   │   ├── assets/        # Logo và tài nguyên
│   │   ├── components/    # Thành phần giao diện dùng chung
│   │   ├── features/      # Mỗi chức năng có API và giao diện riêng
│   │   ├── services/      # HTTP, phiên đăng nhập, thời gian chờ, đối soát
│   │   ├── types/         # Kiểu dữ liệu chung
│   │   ├── App.tsx
│   │   └── index.css      # Biến màu và kiểu giao diện chung
│   └── tests/             # Kiểm thử đơn vị, trình duyệt, tích hợp, tải, tiện ích
├── docs/                  # Tài liệu tiếng Việt
├── docker-compose.yml
└── README.md
```

## Kiểm thử

Từ `backend`:

```sh
python -m unittest discover -s tests -q
```

Từ `frontend`:

```sh
npm test
npm run build
npm run test:notifications
```

Các bộ kiểm thử trình duyệt yêu cầu Docker đang chạy. Chi tiết nhóm, điều kiện và lệnh tại [hướng dẫn kiểm thử giao diện](frontend/tests/README.md) và [hướng dẫn kiểm thử máy chủ](backend/tests/README.md).

Cấp quyền chia sẻ và xem lịch cá nhân: [hướng dẫn chia sẻ lịch](docs/calendar-sharing.md).
