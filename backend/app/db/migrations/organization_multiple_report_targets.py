from sqlalchemy import text

from app.db.organization import JobLevelReportTarget


async def migrate_organization_multiple_report_targets(conn):
    await conn.run_sync(lambda sync: JobLevelReportTarget.__table__.create(sync, checkfirst=True))
    await conn.execute(text('''
        INSERT INTO job_level_report_targets(job_level_id, manager_level_id)
        SELECT id, reports_to_level_id FROM job_levels
        WHERE reports_to_level_id IS NOT NULL
        ON CONFLICT (job_level_id, manager_level_id) DO NOTHING
    '''))
