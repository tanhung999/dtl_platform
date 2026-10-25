# DTL Platform — Cổng làm việc số và đăng nhập một lần

Cổng làm việc tập trung cho cán bộ nhân viên **Đông Tây Land**, kết nối đăng nhập một lần (SSO) tới Booking Reports, Workflows và Asset Manager. Không gian cá nhân gồm Ghi chú, Công việc, Liên kết, Lịch cá nhân và Thông báo.

Hướng dẫn tích hợp website mới, manifest role/permission và checklist production: [docs/central-identity-integration.md](docs/central-identity-integration.md).

## Kiến trúc và công nghệ

- Giao diện: React 18, TypeScript, Vite, biểu tượng Lucide React; CSS hỗ trợ sáng/tối và nhiều kích thước màn hình. Điều hướng trang dùng React Router.
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

1. Người dùng luôn đăng nhập bằng form React gốc tại URL `/login` của Platform; trình duyệt không tải giao diện Keycloak.
2. Backend Platform xác thực với Keycloak qua token API nội bộ, tạo phiên HttpOnly, đọc registry quyền và chỉ hiển thị ứng dụng được cấp.
3. Khi mở ứng dụng, Platform gọi POST `/api/sso/launch` với `target_app` và `return_to` tương đối.
4. Platform phát hành SSO ticket ký số, sống ngắn và chỉ dùng một lần. Ứng dụng đích đổi ticket qua back-channel, tạo phiên cục bộ và kiểm tra entitlement trực tiếp với Platform.
5. Nếu mở URL ứng dụng con khi chưa đăng nhập, trình duyệt quay về `/login?app=...&return_to=...` của Platform; đăng nhập xong sẽ trở lại đúng ứng dụng và đường dẫn ban đầu.

Mỗi ứng dụng dùng một integration secret riêng (`BOOKINGREPORTS_INTEGRATION_SECRET`, `WORKFLOWS_INTEGRATION_SECRET`, `ITAM_INTEGRATION_SECRET`). SSO ticket là vé một lần có thời hạn 60 giây; Keycloak không xuất hiện trên trình duyệt.

## Phần tích hợp phía các ứng dụng doanh nghiệp

Booking Reports, Workflows và Asset Manager đều dùng cùng danh tính Keycloak thông qua backend Platform và quyền do Platform quản lý. Mỗi ứng dụng vẫn duy trì hồ sơ nghiệp vụ/phiên cục bộ, nhưng không tự quản lý mật khẩu hay tự cấp role khi xác thực tập trung bật. Quyền bị thu hồi tại Platform có hiệu lực sau tối đa 30 giây theo cache entitlement mặc định.

Website mới phải đăng ký application manifest, callback `/api/auth/platform/callback`, role/permission mapping và integration secret riêng theo [hướng dẫn tích hợp](docs/central-identity-integration.md). API thông báo cũng dùng khóa riêng cho từng nguồn, tách biệt khỏi khóa đăng nhập và entitlement.

## Chức năng chính

- **Trang chủ:** tổng quan công việc, lịch, ghi chú và liên kết nhanh DT Link.
- **DT Platform:** truy cập các ứng dụng doanh nghiệp qua SSO.
- **DT Calendar:** xem tuần/tháng/danh sách, sự kiện có giờ hoặc cả ngày, lịch lặp và chia sẻ lịch theo quyền.
- **DT Task:** quản lý công việc, độ ưu tiên, hạn hoàn thành và đồng bộ với lịch.
- **DT My Note:** quản lý ghi chú và gắn vào lịch, hỗ trợ lịch lặp và thông báo.
- **Thông báo:** chuông, lịch sử, đánh dấu đã đọc và thông báo theo thời gian do máy chủ xử lý.
- **Hồ sơ và quản trị:** thông tin tài khoản và các chức năng theo quyền người dùng.

Lịch lặp hỗ trợ thao tác trên cả chuỗi, lần đang chọn hoặc lần đang chọn và các lần sau. Thay đổi ngày giờ và thông báo được thực hiện trong **Dời lịch / Thông báo**.

## Điều hướng và triển khai giao diện

Các đường dẫn chính: `/homepage`, `/platform`, `/calendar`, `/tasks`, `/notes`, `/profile`, `/admin`, `/notifications`, `/search` và `/login`. DT Link mở khu vực liên kết trên trang chủ.

Build giao diện bằng:

```sh
cd frontend
npm ci
npm run build
```

Phục vụ thư mục `frontend/dist` bằng máy chủ web. Cấu hình SPA fallback để mở trực tiếp hoặc tải lại `/calendar` và các trang khác vẫn hoạt động. Ví dụ Nginx:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Cấu hình proxy `/api/` đến FastAPI riêng; không trả `index.html` cho yêu cầu API. `docker-compose.yml` dành cho phát triển cục bộ. Production dùng `docker compose -f docker-compose.prod.yml up -d --build`; frontend được build tĩnh và phục vụ qua Nginx, Keycloak chạy chế độ production và database không publish ra máy chủ.

Trước khi triển khai, đặt khóa JWT/SSO, mật khẩu cơ sở dữ liệu và URL ứng dụng phù hợp với môi trường; không sử dụng giá trị mẫu trong Compose. Tham khảo `.env.example` và `backend/app/core/config.py` cho cấu hình. Sao lưu cơ sở dữ liệu trước khi nâng cấp. Máy chủ áp dụng các migration đã đăng ký khi khởi động.

## Nội dung kho mã

Kho mã giữ mã nguồn, tài nguyên giao diện, migration, cấu hình build/triển khai, file khóa thư viện và mã kiểm thử. Báo cáo rà soát, nhật ký sửa chữa, log và bản sao lưu chỉ lưu cục bộ; `docs/` và `.audit-backups/` được Git bỏ qua.

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
