"""Upgrade dữ liệu cũ giữ lịch sử, bỏ lượt tự động chưa gửi, chạy lại an toàn."""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from tests.support.api_case import ApiTestCase
from app.db.migrations.user_reminders import migrate_user_reminders
from app.db.migrations.runner import upgrade
from app.db.migrations.shared_notifications import migrate_shared_notifications

class ReminderMigrationTests(ApiTestCase):
    async def test_existing_schema_preserves_history_and_cancels_implicit_jobs(self):
        async with self.engine.begin() as conn:
            await conn.execute(text("DROP TABLE notification_jobs"))
            await conn.execute(text("""CREATE TABLE notification_jobs (
                id VARCHAR(36) PRIMARY KEY, task_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL, deadline_version INTEGER NOT NULL,
                kind VARCHAR(20) NOT NULL, event_key VARCHAR(200) NOT NULL UNIQUE,
                scheduled_at TIMESTAMP NOT NULL, available_at TIMESTAMP NOT NULL, processed_at TIMESTAMP)"""))
            for table in ('tasks','calendar_events'):
                for column in ('reminder_minutes','reminder_at','reminder_version'):
                    await conn.execute(text(f'ALTER TABLE {table} DROP COLUMN {column}'))
            await conn.execute(text('DROP TABLE notifications'))
            await conn.execute(text("""CREATE TABLE notifications (
                id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, source VARCHAR(20) NOT NULL,
                event_key VARCHAR(200) NOT NULL, fingerprint VARCHAR(64) NOT NULL, kind VARCHAR(40) NOT NULL,
                title VARCHAR(255) NOT NULL, body VARCHAR(1200) NOT NULL, resource_type VARCHAR(40) NOT NULL,
                resource_id VARCHAR(128) NOT NULL, action_path VARCHAR(500) NOT NULL, task_id VARCHAR(36),
                deadline_version INTEGER, due_at TIMESTAMP, occurred_at TIMESTAMP NOT NULL, created_at TIMESTAMP NOT NULL,
                read_at TIMESTAMP, dismissed_at TIMESTAMP, snoozed_until TIMESTAMP,
                UNIQUE(user_id,source,event_key))"""))
            for id, processed in [('pending',None),('sent','2026-10-12 00:00:00')]:
                await conn.execute(text("""INSERT INTO notification_jobs VALUES
                    (:id,'task','alice',0,'day',:id,'2026-10-12 00:00:00','2026-10-12 00:00:00',:processed)"""),dict(id=id,processed=processed))
            await conn.execute(text("""INSERT INTO notifications
                (id,user_id,source,event_key,fingerprint,kind,title,body,resource_type,resource_id,action_path,occurred_at,created_at)
                VALUES ('history','alice','platform','old','old','task.day','Keep','Keep','task','task','','2026-10-12','2026-10-12')"""))
            await migrate_user_reminders(conn); await migrate_user_reminders(conn)
            self.assertEqual((await conn.execute(text('SELECT id FROM notification_jobs'))).scalars().all(),['sent'])
            self.assertEqual((await conn.execute(text('SELECT title FROM notifications'))).scalars().all(),['Keep'])
            await migrate_shared_notifications(conn); await migrate_shared_notifications(conn)
            self.assertEqual((await conn.execute(text('SELECT title, calendar_owner_id FROM notifications'))).all(),[('Keep',None)])
            await conn.execute(text("INSERT INTO notification_jobs (id,user_id,deadline_version,kind,event_key,scheduled_at,available_at) VALUES ('event-job','alice',0,'user','event-job','2026-10-20','2026-10-20')"))

    async def test_fresh_upgrade_and_repeated_upgrade_do_not_seed_implicit_jobs(self):
        engine=create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await upgrade(conn); await upgrade(conn)
                self.assertEqual(await conn.scalar(text('SELECT COUNT(*) FROM notification_jobs')),0)
                self.assertIsNone(await conn.scalar(text("SELECT name FROM sqlite_master WHERE type='table' AND name='task_reminder_receipts'")))
                self.assertEqual(await conn.scalar(text("SELECT COUNT(*) FROM schema_migrations WHERE version='notifications_002_user_selected_reminders'")),1)
        finally: await engine.dispose()
