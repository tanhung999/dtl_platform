"""Migration for task delegation and calendar event followers."""
from sqlalchemy import inspect, text


async def migrate_task_delegation_and_followers(conn):
    # 1. Add assignee_id to tasks and backfill
    columns = await conn.run_sync(lambda sync: {col['name'] for col in inspect(sync).get_columns('tasks')})
    if 'assignee_id' not in columns:
        await conn.execute(text("ALTER TABLE tasks ADD COLUMN assignee_id VARCHAR(36)"))
    await conn.execute(text("UPDATE tasks SET assignee_id = user_id WHERE assignee_id IS NULL"))
    if conn.dialect.name == 'postgresql':
        await conn.execute(text("ALTER TABLE tasks ALTER COLUMN assignee_id SET NOT NULL"))
        foreign_keys = await conn.run_sync(lambda sync: {fk.get('name') for fk in inspect(sync).get_foreign_keys('tasks')})
        if 'fk_tasks_assignee' not in foreign_keys:
            await conn.execute(text("ALTER TABLE tasks ADD CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE RESTRICT"))

    indexes = await conn.run_sync(lambda sync: {idx['name'] for idx in inspect(sync).get_indexes('tasks')})
    if 'ix_tasks_assignee' not in indexes:
        await conn.execute(text("CREATE INDEX ix_tasks_assignee ON tasks (assignee_id)"))

    # 2. Create task_followers table
    tables = await conn.run_sync(lambda sync: inspect(sync).get_table_names())
    if 'task_followers' not in tables:
        await conn.execute(text("""
            CREATE TABLE task_followers (
                id VARCHAR(36) PRIMARY KEY,
                task_id VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                added_by_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_task_followers_task_user UNIQUE (task_id, user_id)
            )
        """))
        await conn.execute(text("CREATE INDEX ix_task_followers_user ON task_followers (user_id)"))
        await conn.execute(text("CREATE INDEX ix_task_followers_task ON task_followers (task_id)"))

    # 3. Create calendar_event_followers table
    if 'calendar_event_followers' not in tables:
        await conn.execute(text("""
            CREATE TABLE calendar_event_followers (
                id VARCHAR(36) PRIMARY KEY,
                event_id VARCHAR(36) NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
                user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                added_by_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_calendar_event_followers_event_user UNIQUE (event_id, user_id)
            )
        """))
        await conn.execute(text("CREATE INDEX ix_calendar_event_followers_user ON calendar_event_followers (user_id)"))
        await conn.execute(text("CREATE INDEX ix_calendar_event_followers_event ON calendar_event_followers (event_id)"))

    # 4. Seed the capability in the same migration transaction.  Opening an
    # AsyncSession on an AsyncConnection here caused nested transaction issues
    # on SQLite and could make the schema migration only partially durable.
    await conn.execute(text("INSERT INTO access_permissions (code, name) VALUES ('tasks.assign', 'Giao công việc cho nhân viên') ON CONFLICT (code) DO NOTHING"))
    await conn.execute(text("INSERT INTO access_role_permissions (role_id, permission_code) VALUES ('access_admin', 'tasks.assign') ON CONFLICT (role_id, permission_code) DO NOTHING"))

    # 5. Invalidate workspace versions for tasks and shared calendar
    try:
        await conn.execute(text("UPDATE workspace_versions SET tasks=tasks+1, shared_calendar=shared_calendar+1"))
    except Exception:
        pass
