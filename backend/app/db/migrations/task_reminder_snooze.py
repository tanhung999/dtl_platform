from sqlalchemy import inspect, text


async def migrate_task_reminder_snooze(conn):
    columns = await conn.run_sync(lambda sync: (
        {column['name'] for column in inspect(sync).get_columns('task_reminder_receipts')}
        if inspect(sync).has_table('task_reminder_receipts') else set()
    ))
    if columns and 'snoozed_until' not in columns:
        datatype = 'TIMESTAMP WITH TIME ZONE' if conn.dialect.name == 'postgresql' else 'DATETIME'
        await conn.execute(text(f'ALTER TABLE task_reminder_receipts ADD COLUMN snoozed_until {datatype}'))
