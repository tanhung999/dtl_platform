from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from app.core.config import settings
from app.core.database import engine, async_session_maker
from app.core.security import hash_password
from app.db.models import User, Note, Task, Bookmark
from app.db.migrations.runner import upgrade
from app.modules.tasks.deadlines import VN
from app.modules.access.router import router as access_router
from app.modules.calendar_sharing.router import router as sharing_router
from app.modules.auth.router import router as auth_router
from app.modules.sso.router import router as sso_router
from app.modules.notes.router import router as notes_router
from app.modules.notes.collection import router as notes_collection_router
from app.modules.tasks.collection import router as task_collection_router
from app.modules.tasks.router import router as tasks_router
from app.modules.rescheduling.router import router as rescheduling_router
from app.modules.bookmarks.router import router as bookmarks_router
from app.modules.calendar.router import router as calendar_router
from app.modules.calendar.collection import router as calendar_collection_router
from app.modules.realtime.router import router as realtime_router
from app.core.realtime import listen
from app.modules.notifications.router import router as notifications_router
from app.modules.notifications.integrations import router as notification_integrations_router
from app.modules.notifications.worker import run_worker
from app.modules.notifications.scheduling import sync_task_jobs
from app.modules.maintenance.cleanup import run_cleanup_worker


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

            from app.db.access import UserRole
            session.add(UserRole(user_id=admin.id, role_id='access_admin'))

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
                due_date=datetime.now(VN).date().isoformat(),
                is_completed=False,
            )
            t2 = Task(
                user_id=admin.id,
                title="Duyệt hồ sơ trình ký trên Workflows",
                priority="URGENT",
                due_date=datetime.now(VN).date().isoformat(),
                is_completed=False,
            )
            t3 = Task(
                user_id=admin.id,
                title="Bàn giao tài sản thiết bị tháng này",
                priority="MEDIUM",
                due_date=(datetime.now(VN).date() + timedelta(days=6 - datetime.now(VN).weekday())).isoformat(),
                is_completed=True,
            )
            session.add_all([t1, t2, t3])
            await session.flush()
            for task in (t1, t2, t3):
                await sync_task_jobs(session, task)

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
    async with engine.begin() as conn:
        await upgrade(conn)
    await seed_initial_data()
    try:
        async with listen(settings.DATABASE_URL), run_worker(settings.NOTIFICATIONS_WORKER_ENABLED), run_cleanup_worker(settings.MAINTENANCE_ENABLED):
            yield
    finally:
        await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    description="Digital Workplace & Single Sign-On Portal cho Đông Tây Land",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.DEBUG else settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(access_router)
app.include_router(sharing_router)
app.include_router(auth_router)
app.include_router(notifications_router)
app.include_router(notification_integrations_router)
app.include_router(sso_router)
app.include_router(calendar_collection_router)
app.include_router(notes_collection_router)
app.include_router(task_collection_router)
app.include_router(notes_router)
app.include_router(tasks_router)
app.include_router(rescheduling_router)
app.include_router(bookmarks_router)
app.include_router(calendar_router)
app.include_router(realtime_router)


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}
