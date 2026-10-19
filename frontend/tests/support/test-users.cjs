const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const createScript = `import asyncio,json,sys
from app.core.database import async_session_maker
from app.core.security import hash_password
from app.db.models import User
from app.db.task_reminders import TaskReminderReceipt
async def run():
    accounts=json.load(sys.stdin)
    async with async_session_maker() as session:
        for account in accounts:
            session.add(User(id=account['id'],username=account['username'],email=account['username']+'@example.com',full_name='Drag QA',password_hash=hash_password(account['password']),allowed_apps='bookingreports,workflows,itam'))
        await session.commit()
asyncio.run(run())`;
const removeScript = `import asyncio,json,sys
from sqlalchemy import delete
from app.core.database import async_session_maker
from app.db.models import User
from app.db.task_reminders import TaskReminderReceipt
async def run():
    accounts=json.load(sys.stdin)
    async with async_session_maker() as session:
        await session.execute(delete(User).where(User.id.in_([a['id'] for a in accounts]),User.username.in_([a['username'] for a in accounts]),User.username.like('dragqa_%')))
        await session.commit()
asyncio.run(run())`;
function execute(script, accounts) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', script], { cwd: path.resolve(__dirname, '../../..'), input: JSON.stringify(accounts), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Unable to prepare isolated drag QA accounts');
}
exports.createDragUsers = (count = 2) => {
  const accounts = Array.from({ length: count }, () => ({ id: randomUUID(), username: 'dragqa_' + randomUUID().replaceAll('-', ''), password: 'Drag-QA-temporary-123' }));
  execute(createScript, accounts);
  return { accounts, cleanup: () => execute(removeScript, accounts) };
};
