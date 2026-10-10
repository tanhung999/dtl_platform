from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.core.config import settings
from app.core.database import Base, engine, async_session_maker
from app.core.security import hash_password
from app.db.models import User, Note, Task, Bookmark
from app.modules.auth.router import router as auth_router
from app.modules.sso.router import router as sso_router
from app.modules.notes.router import router as notes_router
from app.modules.tasks.router import router as tasks_router
from app.modules.bookmarks.router import router as bookmarks_router


async def seed_initial_data():
    async with async_session_maker() as session:
        # Check if admin exists
        stmt = select(User).where(User.username == "admin")
        result = await session.execute(stmt)
        admin = result.scalar_one_or_none()
        
        if not admin:
            admin = User(
                username="admin",
                email="admin@dongtayland.vn",
                full_name="Quản Trị Viên DTL",
                role="Quản Trị Viên",
                department="Công Nghệ & Chuyển Đổi Số",
                job_title="Trưởng Nhóm Phát Triển Phần Mềm",
                employee_code="DTL-001",
                phone="0901.525.178",
                office_location="Trụ sở chính - TP. Hồ Chí Minh",
                bio="Quản trị viên cổng làm việc tập trung và phân quyền hệ thống Đông Tây Land.",
                allowed_apps="bookingreports,workflows,itam",
                password_hash=hash_password("admin123"),
            )
            session.add(admin)
            await session.flush()

            # Seed sample notes
            n1 = Note(
                user_id=admin.id,
                title="Chào mừng đến với DTL Platform",
                content="Platform tích hợp SSO cho Booking Reports, Workflows và Asset Manager. Bạn có thể ghi chú nhanh hoặc tạo danh sách việc cần làm tại đây.",
                color="#fef08a",
                is_pinned=True,
            )
            n2 = Note(
                user_id=admin.id,
                title="Lịch họp giao ban tuần",
                content="- Thứ Hai: 8h30 họp kinh doanh toàn công ty\n- Thứ Năm: 14h00 review tiến độ dự án IT\n- Thứ Sáu: Tổng kết tuần",
                color="#bbf7d0",
                is_pinned=False,
            )
            session.add_all([n1, n2])

            # Seed sample tasks
            t1 = Task(
                user_id=admin.id,
                title="Kiểm tra hệ thống báo cáo dự án tuần mới",
                priority="HIGH",
                due_date="Hôm nay",
                is_completed=False,
            )
            t2 = Task(
                user_id=admin.id,
                title="Duyệt hồ sơ trình ký trên Workflows",
                priority="URGENT",
                due_date="Hôm nay",
                is_completed=False,
            )
            t3 = Task(
                user_id=admin.id,
                title="Bàn giao tài sản thiết bị tháng này",
                priority="MEDIUM",
                due_date="Tuần này",
                is_completed=True,
            )
            session.add_all([t1, t2, t3])

            # Seed sample bookmarks
            b1 = Bookmark(
                title="Webmail Đông Tây Land",
                url="https://mail.dongtayland.vn",
                category="Hệ thống nội bộ",
                is_global=True,
            )
            b2 = Bookmark(
                title="Cổng thông tin nhân sự",
                url="https://hrm.dongtayland.vn",
                category="Hệ thống nội bộ",
                is_global=True,
            )
            session.add_all([b1, b2])

            await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables automatically
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed initial test data
    await seed_initial_data()
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    description="Digital Workplace & Single Sign-On Portal cho Đông Tây Land",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.DEBUG else settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(auth_router)
app.include_router(sso_router)
app.include_router(notes_router)
app.include_router(tasks_router)
app.include_router(bookmarks_router)


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}
