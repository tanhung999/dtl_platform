# DTL Platform (Digital Workplace & SSO Portal)

> Cổng làm việc số tập trung cho cán bộ nhân viên **Đông Tây Land**: Tích hợp Đăng nhập một lần (**Single Sign-On - SSO**) vào 3 hệ thống nghiệp vụ, đồng thời cung cấp bàn làm việc cá nhân (**Start.me style**) gồm **Ghi chú nhanh (Notes)**, **Quản lý công việc (Tasks)** và **Liên kết nhanh (Bookmarks)**.

---

## 📌 1. Kiến trúc & Công nghệ (Tech Stack)

- **Frontend**:
  - React 18+ (TypeScript), Vite
  - Lucide React (Bộ icon hiện đại)
  - CSS Glassmorphism & Responsive Grid layout
  - REST API Client (`api.ts`) với lưu trữ phiên an toàn
- **Backend**:
  - FastAPI (Python 3.10+ / 3.11+ async)
  - SQLAlchemy 2.0 (Async ORM)
  - CSDL: Hỗ trợ SQLite (chạy dev tức thì) hoặc PostgreSQL (Production)
  - PyJWT (Mã hóa phiên Bearer và ký vé SSO Ticket HMAC SHA-256)
  - Passlib / PBKDF2 HMAC SHA-256 (Hash mật khẩu an toàn)

---

## 🚀 2. Hướng dẫn Khởi chạy Nhanh (Quickstart)

### Cách 1: Chạy trực tiếp bằng Python & Node.js

#### Bước 1: Khởi động Backend
```bash
cd backend
python -m venv .venv
# Trên Windows:
.venv\Scripts\activate
# Trên Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
> Khi khởi động lần đầu, Backend sẽ **tự động tạo database `platform.db`** và khởi tạo tài khoản mặc định:
> - **Username**: `admin`
> - **Password**: `admin123`

Swagger UI xem API: `http://localhost:8000/docs`

#### Bước 2: Khởi động Frontend
```bash
cd frontend
npm install
npm run dev
```
Truy cập giao diện: `http://localhost:5173`

---

### Cách 2: Chạy toàn bộ bằng Docker Compose
```bash
docker compose up -d
```
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`

---

## 🔑 3. Luồng hoạt động của Single Sign-On (SSO)

```
[User trên Platform]
       |
       | 1. Bấm vào Card "Booking Reports" / "Workflows" / "Asset Manager"
       v
[Platform Backend: POST /api/sso/launch]
       |
       | 2. Ký SSO Ticket (JWT 60s, Single-Use) bằng SSO_SECRET_KEY
       v
[Mở tab mới với URL Callback]
       | https://reports.dtl.vn/sso-callback?ticket=eyJhbGciOi...
       v
[Sub-App Backend: POST /api/auth/sso-login]
       | 3. Giải mã ticket với SSO_SECRET_KEY
       | 4. Tìm User theo email / username trong DB của Sub-App
       | 5. Cấp Session / Token nội bộ của Sub-App
       v
[User vào thẳng Dashboard của Sub-App mà không cần nhập mật khẩu!]
```

---

## 📋 4. BẢNG PHÂN CHIA NHIỆM VỤ CHO DEVELOPER (TASK BACKLOG)

Dưới đây là danh sách đầu việc chi tiết để bạn phân công cho các thành viên trong nhóm:

### 🧩 Task 1: Tích hợp SSO Receiver cho `bookingreports` (Dev Backend/Frontend)
- [ ] **Backend `bookingreports`**: Bổ sung endpoint `POST /api/auth/sso-login`:
  - Giải mã ticket gửi lên bằng `SSO_SECRET_KEY`.
  - Tìm `users` theo `email` hoặc `username`.
  - Gọi hàm `issue_refresh_token(conn, user['id'])` và trả về `auth_response(...)`.
- [ ] **Frontend `bookingreports`**: Thêm route `/sso-callback` để nhận `ticket` từ query params và lưu phiên vào localStorage/cookie rồi chuyển hướng vào `/`.

### 🧩 Task 2: Tích hợp SSO Receiver cho `Workflows` (Dev Backend/Frontend)
- [ ] **Backend `Workflows`**: Bổ sung endpoint `POST /api/auth/sso-login`:
  - Giải mã ticket gửi lên bằng `SSO_SECRET_KEY`.
  - Tìm `User` trong DB theo `username == claims['sub']`.
  - Tạo record phiên trong bảng `auth_sessions`, sinh refresh token và trả về `TokenResponse`.
- [ ] **Frontend `Workflows`**: Thêm route `/sso-callback` nhận ticket và gọi API đăng nhập.

### 🧩 Task 3: Tích hợp SSO Receiver cho `Asset-Manager` (Dev Backend/Frontend)
- [ ] **Backend `Asset-Manager`**: Bổ sung endpoint `POST /api/auth/sso-login`:
  - Giải mã ticket gửi lên bằng `SSO_SECRET_KEY`.
  - Tìm `User` trong DB theo `username`.
  - Thiết lập `session['user_id'] = user.id` và sinh JWT `generate_local_jwt`.
- [ ] **Frontend `Asset-Manager`**: Bổ sung route `/sso-callback` đón vé và vào màn hình chính.

### 🧩 Task 4: Nâng cấp Bàn làm việc Platform (Dev Frontend Platform)
- [ ] **Drag & Drop Layout**: Tích hợp `@dnd-kit` hoặc `react-grid-layout` để người dùng có thể kéo thả hoán đổi vị trí các cột Widget trên Dashboard.
- [ ] **Rich-text Note**: Tích hợp thư viện Tiptap hoặc Markdown editor mini cho Sticky Notes.
- [ ] **Badges đếm thông báo**: Bổ sung API poll ngầm số lượng hồ sơ chờ duyệt trên Workflows để hiển thị con số ngay trên thẻ App Launcher.

---

## 📂 5. Cấu trúc Thư mục

Module lịch cá nhân, database và hướng dẫn kiểm thử: [docs/calendar.md](docs/calendar.md).
Đồng bộ To-Do, nhắc hạn và cập nhật realtime: [docs/task-deadlines.md](docs/task-deadlines.md).

```text
dtl-platform/
├── backend/
│   ├── app/
│   │   ├── core/          # config.py, database.py, security.py (SSO & JWT)
│   │   ├── db/            # models.py (User, Note, Task, Bookmark)
│   │   ├── modules/
│   │   │   ├── auth/      # Login, logout, getMe
│   │   │   ├── sso/       # Tạo vé SSO Ticket & API verify
│   │   │   ├── notes/     # CRUD Ghi chú màu sắc, ghim
│   │   │   ├── tasks/     # CRUD To-do list, ưu tiên, deadline
│   │   │   └── bookmarks/ # CRUD Phím tắt liên kết nội bộ
│   │   └── main.py        # Khởi tạo FastAPI, CORS, auto-seed admin
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── assets/        # Logo Đông Tây Land
│   │   ├── components/    # Navbar, Footer
│   │   ├── features/      # auth, apps (SSO launcher), notes, tasks, bookmarks
│   │   ├── services/      # api.ts
│   │   ├── types/         # index.ts
│   │   ├── App.tsx
│   │   └── index.css      # Giao diện glassmorphism, responsive widget grid
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml
└── README.md
```
