// Run the real worker at a controlled future instant, strictly scoped to a QA account.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const script = `import asyncio,json,sys
from datetime import timedelta
from sqlalchemy import event,select,func
from sqlalchemy.orm import with_loader_criteria
from app.core.database import async_session_maker
from app.db.models import User
from app.db.notifications import NotificationJob as Job
from app.modules.notifications.worker import deliver_batch
from app.core.realtime import prepare_changes
async def run():
    owner=json.load(sys.stdin)['id']
    async with async_session_maker() as db:
        user=await db.get(User,owner)
        assert user and user.username.startswith('testqa_')
        stamp=await db.scalar(select(func.max(Job.available_at)).where(Job.user_id==owner,Job.processed_at.is_(None)))
        if not stamp: return
        def scope(state):
            if state.is_select:
                state.statement=state.statement.options(with_loader_criteria(Job, Job.user_id==owner))
        event.listen(db.sync_session,'do_orm_execute',scope)
        await deliver_batch(db,stamp+timedelta(seconds=1))
        await prepare_changes(db); await db.commit()
asyncio.run(run())`;
exports.deliverReminders = account => {
  const result=spawnSync('docker',['compose','exec','-T','platform-backend','python','-c',script],{
    cwd:path.resolve(__dirname,'../../..'),input:JSON.stringify(account),encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||result.stdout);
};
