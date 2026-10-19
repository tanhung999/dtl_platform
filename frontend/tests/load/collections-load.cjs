// Isolated local capacity smoke test. Creates 300 accounts, holds 200 SSE streams,
// exercises personal collection APIs and removes only its own UUID-scoped fixtures.
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const runId = randomUUID().replaceAll('-', '');
const accounts = Array.from({ length: 300 }, (_, i) => ({ id: randomUUID(), username: `capacity_${runId}_${i}` }));
function python(script) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', script], {
    cwd: root, input: JSON.stringify(accounts), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000,
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Capacity fixture command failed');
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}
const setup = `import asyncio,json,sys,uuid
from datetime import datetime,timedelta,timezone
from sqlalchemy import insert
from app.core.database import async_session_maker
from app.db.models import User,Task,Note
from app.db.task_reminders import TaskReminderReceipt
from app.db.notifications import Notification,NotificationJob
from app.modules.notifications.scheduling import plan
from types import SimpleNamespace
from app.db.calendar import CalendarEvent
from app.core.security import hash_password,create_access_token
from app.modules.tasks.queries import task_order,after_task
from sqlalchemy import select,text
async def run():
 accounts=json.load(sys.stdin); stamp=datetime.now(timezone.utc); day=stamp.astimezone(timezone(timedelta(hours=7))).date(); password=hash_password(str(uuid.uuid4()))
 async with async_session_maker() as db:
  await db.execute(insert(User),[dict(**a,email=a['username']+'@example.com',password_hash=password,full_name='Capacity QA') for a in accounts])
  task_ids=[]
  for a in accounts:
   task_id=str(uuid.uuid4());task_ids.append(task_id)
   await db.execute(insert(Task),[dict(id=task_id if i==0 else str(uuid.uuid4()),user_id=a['id'],title='Task '+str(i),due_date=(day+timedelta(days=i%14)).isoformat(),due_time='16:00',priority='MEDIUM') for i in range(100)])
   await db.execute(insert(Note),[dict(user_id=a['id'],title='Meeting '+str(i),content='Meeting content '*100,search_text='meeting content '+str(i),is_pinned=i<10,sort_order=i) for i in range(20)])
   await db.execute(insert(CalendarEvent),[dict(user_id=a['id'],title='Event '+str(i),description='Detailed content '*100,starts_at=stamp+timedelta(hours=i),ends_at=stamp+timedelta(hours=i+1)) for i in range(10)])
   await db.execute(insert(Notification),[dict(user_id=a['id'],source='workflows',event_key='capacity-'+str(i),fingerprint='qa',kind='external.info',title='Notification '+str(i),body='Short preview',resource_type='workflows.record',occurred_at=stamp) for i in range(50)])
   jobs=plan(SimpleNamespace(id=task_id,user_id=a['id'],due_date=day.isoformat(),due_time='16:00',deadline_version=0,is_completed=False),stamp)
   if jobs: await db.execute(insert(NotificationJob),jobs)
  # One large account for deep pagination/reorder measurements, outside active 200.
  owner=accounts[-1]['id']
  await db.execute(insert(Task),[dict(user_id=owner,title='Large task '+str(i),due_date=(day+timedelta(days=i%90)).isoformat(),priority='MEDIUM') for i in range(10000)])
  await db.execute(insert(Note),[dict(user_id=owner,title='Large note '+str(i),content='body',search_text='large note '+str(i),sort_order=20+i) for i in range(10000)])
  await db.commit()
  await db.execute(text('ANALYZE tasks'));await db.execute(text('ANALYZE notes'))
  plans={}
  anchor=await db.scalar(select(Task.id).where(Task.user_id==owner).order_by(*task_order(db)).offset(9000).limit(1))
  seek=await after_task(db,owner,anchor)
  for name,stmt in [('tasks_first',select(Task).where(Task.user_id==owner).order_by(*task_order(db)).limit(25)),('tasks_deep',select(Task).where(Task.user_id==owner).order_by(*task_order(db)).offset(9000).limit(25)),('tasks_seek',select(Task).where(Task.user_id==owner,seek).order_by(*task_order(db)).limit(25))]:
   sql=str(stmt.compile(dialect=db.bind.dialect,compile_kwargs={'literal_binds':True}))
   plans[name]=await db.scalar(text('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql))
  ranked=(await db.execute(select(Note.id,Note.sort_order).where(Note.user_id==owner).order_by(Note.sort_order))).all()
  from app.modules.notes.ordering import move_note,NoteMove
  from app.core.realtime import prepare_changes
  import time
  begin=time.perf_counter(); user=await db.get(User,owner)
  await move_note(ranked[-1].id,NoteMove(expected_version=0,placement='start'),user,db)
  await prepare_changes(db);await db.commit();plans['note_move_ms']=(time.perf_counter()-begin)*1000
 print(json.dumps(dict(tokens=[create_access_token({'sub':a['username']}) for a in accounts],task_ids=task_ids,day=day.isoformat(),plans=plans)))
asyncio.run(run())`;
const cleanup = `import asyncio,json,sys
from sqlalchemy import delete
from app.core.database import async_session_maker
from app.db.models import User
from app.db.task_reminders import TaskReminderReceipt
async def run():
 accounts=json.load(sys.stdin)
 async with async_session_maker() as db:
  await db.execute(delete(User).where(User.id.in_([a['id'] for a in accounts]),User.username.in_([a['username'] for a in accounts])));await db.commit()
asyncio.run(run())`;

(async () => {
  const connections = [], samples = [], byEndpoint = {}, failures = [], base = 'http://127.0.0.1:8000/api';
  let writes = 0;
  let fixture;
  try {
    fixture = python(setup);
    const start = fixture.day, end = new Date(Date.parse(start) + 30 * 86400000).toISOString().slice(0, 10);
    const paths = ['/tasks/collection', '/notes/collection/page?widget=true', `/calendar/events/collection?start=${start}T00:00:00%2B07:00&end=${end}T00:00:00%2B07:00`,
      `/calendar/days?start=${start}&end=${end}`, '/notifications/summary', '/notifications?filter=all&limit=25', '/notifications?filter=unread&limit=25', '/notes/collection/page?q=meeting', `/tasks/calendar/page?start=${start}&end=${end}`];
    const opened = Date.now();
    await Promise.all(fixture.tokens.slice(0, 200).map(async token => {
      const controller = new AbortController(); connections.push(controller);
      const response = await fetch(base + '/workspace/stream', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader(); await reader.read();
      // Keep consuming heartbeat frames, but never issue data reads on heartbeat.
      (async () => { try { while (!(await reader.read()).done) {} } catch {} })();
    }));
    const sseOpenMs = Date.now() - opened;
    const deadline = Date.now() + Number(process.env.LOAD_SECONDS || 20) * 1000;
    await Promise.all(fixture.tokens.slice(0, 200).map(async (token, index) => {
      let iteration = 0, version = 0, completed = false;
      while (Date.now() < deadline) {
        const write = iteration % 5 === 4;
        const endpoint = write ? '/tasks/' + fixture.task_ids[index] : paths[(index + iteration) % paths.length], began = performance.now();
        try {
          const response = await fetch(base + endpoint, { method: write ? 'PATCH' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: write ? JSON.stringify({ expected_version: version, is_completed: !completed }) : undefined, signal: AbortSignal.timeout(15000) });
          if (write && response.ok) { const saved = await response.json(); version = saved.version; completed = saved.is_completed; writes++; }
          else await response.arrayBuffer();
          const elapsed = performance.now() - began;
          samples.push(elapsed);
          (byEndpoint[write ? '/tasks/:id PATCH' : endpoint] ??= []).push(elapsed);
          if (!response.ok) failures.push({ endpoint, status: response.status });
        } catch (error) { failures.push({ endpoint, error: error.message }); }
        iteration++;
        await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
      }
    }));
    samples.sort((a, b) => a - b);
    const result = { accounts: 300, activeUsers: 200, sseConnections: 200, sseOpenMs, requests: samples.length, writes,
      p50Ms: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)],
      maxMs: samples.at(-1), failures, byEndpoint: Object.fromEntries(Object.entries(byEndpoint).map(([endpoint, times]) => {
        times.sort((a,b) => a-b); return [endpoint, { count: times.length, p95Ms: times[Math.floor(times.length * .95)] }];
      })), plans: fixture.plans };
    fs.writeFileSync(path.join(root, '.audit-backups', 'notifications-load-300-200.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, plans: { noteMoveMs: fixture.plans.note_move_ms,
      tasksFirstMs: fixture.plans.tasks_first[0]['Execution Time'], tasksDeepMs: fixture.plans.tasks_deep[0]['Execution Time'], tasksSeekMs: fixture.plans.tasks_seek[0]['Execution Time'] } }));
    assert.equal(failures.length, 0, 'Capacity smoke test had failed requests');
  } finally {
    connections.forEach(controller => controller.abort());
    python(cleanup);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
