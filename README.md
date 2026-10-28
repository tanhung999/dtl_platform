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

Khi người tạo đặt thời gian thông báo, hệ thống gửi cho người tạo, người nhận việc và người theo dõi đang có quyền truy cập; người được chia sẻ lịch nhận theo phạm vi đã chia sẻ. Một người có nhiều vai trò chỉ nhận một thông báo cho mỗi lần nhắc. Không chọn thông báo thì không tự gửi; nhắc trước áp dụng cho từng lần lặp, còn ngày giờ cụ thể chỉ gửi một lần. Tùy chọn **Thông báo lịch, công việc và ghi chú do tôi tạo** chỉ tắt thông báo của chính người tạo, không tắt thông báo nhận từ mục được giao/theo dõi/chia sẻ. Các thông báo đã gửi cho người theo dõi bị ẩn khi người đó mất quyền truy cập.

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

Cấu hình proxy `/api/` đến FastAPI riêng; không trả `index.html` cho yêu cầu API. `docker-compose.yml` dành cho phát triển cục bộ. Production cơ bản dùng `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`; frontend được build tĩnh và phục vụ qua Nginx. Keycloak nội bộ được bổ sung bằng cấu hình bên dưới, không có trong Compose production cơ bản.

Trước khi triển khai, đặt khóa JWT/SSO, mật khẩu cơ sở dữ liệu và URL ứng dụng phù hợp với môi trường; không sử dụng giá trị mẫu trong Compose. Tham khảo `.env.example` và `backend/app/core/config.py` cho cấu hình. Sao lưu cơ sở dữ liệu trước khi nâng cấp. Máy chủ áp dụng các migration đã đăng ký khi khởi động.

### Keycloak nội bộ với HTTP cổng 8080

`docker-compose.identity.yml` bổ sung một Keycloak chạy `start`, dùng database/user riêng trong PostgreSQL hiện có. Không publish cổng Keycloak; người dùng tiếp tục dùng form Platform. Ngoại lệ `OIDC_ALLOW_HTTP` chỉ cho phép cookie HTTP, không bỏ qua kiểm tra secret. HTTP công khai vẫn không mã hóa mật khẩu/cookie. Cấu hình này không tự bật đăng nhập tập trung.

Trước khi thực hiện trên server, kiểm tra RAM/CPU/ổ đĩa bằng `free -h`, `docker stats --no-stream`, `df -h`. Keycloak được giới hạn 1 GB RAM và một CPU; cần còn dung lượng cho hệ điều hành, PostgreSQL và các ứng dụng khác. Sao lưu Platform và thử đọc bản dump bằng `pg_restore --list`. Không chạy `down -v` trên production.

1. Sao chép `.env.identity.example` thành `.env.identity` (quyền `600`). Điền mật khẩu database và bootstrap admin ngẫu nhiên, tối thiểu 32 ký tự; giữ `PLATFORM_IDENTITY_ENABLED=false`. Giữ nguyên các secret tích hợp đang có trong `.env.production`. Không đưa các file môi trường lên Git.
2. Luôn dùng cùng project với production hiện tại (ví dụ server đang có `platform-backend-1` dùng project `platform`). Trong shell Ubuntu:

   ```sh
   identity_compose() {
     docker compose -p platform --env-file .env.production --env-file .env.identity \
       -f docker-compose.prod.yml -f docker-compose.identity.yml "$@"
   }
   identity_compose config --quiet
   identity_compose build backend web keycloak
   identity_compose run --rm --no-deps backend python -m app.modules.auth.identity_setup database
   identity_compose up -d --no-deps keycloak
   identity_compose ps keycloak
   ```

   Lệnh `database` không đổi database Platform, từ chối dùng chung tên database/user hoặc ghi đè quyền sở hữu. Nó cần tài khoản PostgreSQL hiện tại có quyền tạo role/database. Lần chạy lại xác minh mật khẩu hiện có, không tự đổi mật khẩu. Chờ Keycloak `healthy`; nếu không, xem log trước khi tiếp tục. Import realm chỉ áp dụng khi realm `dtl` chưa tồn tại; đổi file JSON không cập nhật realm đang có.
3. Dùng môi trường diễn tập riêng trước khi liên kết tài khoản production. Sao chép các file môi trường sang tên riêng và thay toàn bộ secret bằng giá trị test. Thêm `-p platform-identity-rehearsal` và `-f docker-compose.identity-rehearsal.yml` vào TẤT CẢ lệnh Compose. File diễn tập dùng volume và mạng khác production, chỉ mở `127.0.0.1:18080`. Khởi động `db` trước, chạy lệnh `database`, khởi động Keycloak và đợi healthy, rồi khởi động `backend web`. Không dùng project diễn tập với file production đơn lẻ. Trên server truy cập UI qua SSH tunnel `ssh -L 18080:127.0.0.1:18080 ubuntu@SERVER`, rồi mở `http://localhost:18080`. Kiểm tra cả Compose đã resolve (không chia sẻ output chứa secret): volume phải là `platform-identity-rehearsal-postgres` và proxy phải là `platform-identity-rehearsal-proxy`.
4. Sau khi diễn tập đạt, thực hiện liên kết tài khoản production trong khung bảo trì, tạm ngưng thao tác người dùng đến khi hoàn tất chuyển đổi. Liên kết từng user bằng container chạy một lần (giữ nguyên ID, quyền, mật khẩu local và dữ liệu nghiệp vụ Platform):

   ```sh
   identity_compose run --rm --no-deps backend python -m app.modules.auth.identity_setup provision TEN_DANG_NHAP
   ```

   Công cụ hỏi mật khẩu mới hai lần, không hiển thị mật khẩu. Không ghi đè `identity_subject` đã có và không tự nhận tài khoản Keycloak trùng tên/email. Mật khẩu mới phải tối thiểu 8 ký tự và không trùng tên đăng nhập. Tài khoản mới được tạo trên Keycloak; bảng `users` Platform chỉ cập nhật `identity_subject`. Phải hoàn tất liên kết mọi người dùng cần đăng nhập trước khi chuyển. Nếu mất phản hồi COMMIT, công cụ xác minh bằng kết nối mới trước khi quyết định dọn tài khoản Keycloak; nếu chưa xác minh được thì giữ tài khoản và yêu cầu đối soát, không tự xóa.

   Vé SSO vẫn giữ `user_id` và `sub` (tên đăng nhập), nhưng `identity_subject` chuyển từ `platform:<id>` sang ID Keycloak sau khi liên kết. Kiểm tra ứng dụng con dùng trường nào để gắn hồ sơ; ứng dụng chỉ gắn theo `identity_subject` có thể cần liên kết lại hồ sơ cũ. Không tự đổi khóa SSO/tích hợp và không xóa tài khoản ứng dụng con. Đây là lý do không liên kết user production khi người dùng vẫn đang mở SSO trong giai đoạn chuẩn bị.
5. Trong giờ bảo trì, đặt `PLATFORM_IDENTITY_ENABLED=true`, triển khai đồng thời backend và web đã build:

   ```sh
   identity_compose up -d --no-deps backend web
   ```

   Người dùng cần tải lại trang và đăng nhập lại. Bản frontend mới gửi header chống CSRF; tab frontend cũ vẫn được chấp nhận khi gửi JSON kèm Origin khớp chính xác URL cấu hình. Origin khác, biểu mẫu HTML hoặc yêu cầu không có cả Origin và header vẫn bị chặn. Triển khai cùng backend/web để đồng bộ giao diện và chính sách mật khẩu. Kiểm tra đăng nhập, F5, tạo tài khoản, task/lịch/ghi chú cũ, sai mật khẩu, đăng xuất, đổi/đặt lại mật khẩu và khóa tài khoản. Đổi/đặt lại mật khẩu thu hồi các phiên Platform; người dùng tự đổi mật khẩu được đưa về trang đăng nhập. Các access token đã cấp cho ứng dụng bên ngoài có thời hạn riêng; cần kiểm tra từng tích hợp.

   CSP trong Nginx cho phép avatar HTTP/HTTPS ngoài và yêu cầu đăng xuất đến ứng dụng công ty qua HTTP `*.dongtayland.vn:8080` hoặc HTTPS `*.dongtayland.vn`. Ứng dụng ở tên miền/cổng khác cần bổ sung nguồn `connect-src` được tin cậy. Việc trình duyệt được phép gửi logout chưa chứng minh ứng dụng con đã hủy phiên; phải kiểm tra hành vi ở từng ứng dụng.
6. Nếu cần quay lại: đặt `PLATFORM_IDENTITY_ENABLED=false` và triển khai lại backend, giữ nguyên database/volume Keycloak. Tài khoản cũ vẫn giữ mật khẩu local cũ; tài khoản mới chỉ tạo qua Keycloak không có mật khẩu local có thể sử dụng. Quản trị viên phải xử lý các tài khoản phát sinh trước khi quay lại; không khôi phục đè dump cũ và làm mất dữ liệu mới.

Sao lưu riêng cả `dtl_platform_db` và database Keycloak; ghi lại thời điểm để có thể khôi phục đúng cặp. Tài khoản bootstrap chỉ dùng quản trị ban đầu, sau đó tạo tài khoản quản trị thường và xóa bootstrap. Cập nhật realm đang chạy qua Admin API/CLI trong mạng riêng; không publish cổng hoặc bật giao diện Keycloak cho nhân viên. Khóa tài khoản và đổi/đặt lại mật khẩu nên thực hiện qua Platform để thu hồi cả phiên Platform; chưa có back-channel logout tự động cho thay đổi trực tiếp trên Keycloak. Cookie không chứa token Keycloak; token refresh được mã hóa phía server.

Mật khẩu mới tối thiểu 8 ký tự, tối đa 128 ký tự. Với realm đã tồn tại, sau khi pull code hãy chạy `identity_compose exec -T keycloak bash -s < keycloak/update-password-policy.sh`. Công cụ dùng bootstrap admin còn hiệu lực, chỉ đổi điều kiện độ dài tối thiểu thành 8 và giữ các điều kiện khác; không đặt lại mật khẩu hoặc xóa tài khoản. Nếu bootstrap admin đã được xóa, quản trị viên cần cập nhật `length(8)` bằng tài khoản quản trị thường. Công cụ dùng [Keycloak Admin CLI](https://www.keycloak.org/docs/latest/server_admin/index.html#admin-cli) và xóa file phiên quản trị tạm sau khi chạy. Cập nhật image hoặc restart Keycloak không tự thay chính sách của realm đã tồn tại.

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
