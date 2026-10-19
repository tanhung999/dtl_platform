// Kiểm tra tải đọc lịch chia sẻ cục bộ: 300 tài khoản, 200 yêu cầu đồng thời.
// Chỉ tạo/xóa tài khoản UUID của lượt kiểm tra; không in token hoặc sửa tài khoản thật.
const { spawnSync }=require('node:child_process');
const { randomUUID }=require('node:crypto');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),run=randomUUID().replaceAll('-','');
const accounts=Array.from({length:300},(_,i)=>({id:randomUUID(),username:`sharingload_${run}_${i}`}));
const origin=new URL(process.env.SHARING_LOAD_URL||'http://127.0.0.1:8000');
if(!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Chỉ chạy bài đo tải này trên localhost.');
function python(script){const result=spawnSync('docker',['compose','exec','-T','platform-backend','python','-c',script],{cwd:root,input:JSON.stringify(accounts),encoding:'utf8',maxBuffer:4*1024*1024,timeout:60000});if(result.status!==0)throw Error(result.stderr||'Fixture failed');return result.stdout.trim()?JSON.parse(result.stdout):null;}
const setup=`import asyncio,json,sys,uuid
from datetime import datetime,timedelta,timezone,time
from sqlalchemy import insert
from app.core.database import async_session_maker
from app.db.models import User,Task,Note
from app.db.task_reminders import TaskReminderReceipt
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.access import UserRole,CalendarShare
from app.core.security import create_access_token
async def main():
 accounts=json.load(sys.stdin);owner=accounts[0]['id'];vn=timezone(timedelta(hours=7));day=datetime.now(vn).date();start=datetime.combine(day-timedelta(days=day.weekday()),time.min,vn)
 async with async_session_maker() as db:
  await db.execute(insert(User),[dict(**a,email=a['username']+'@example.com',full_name='Sharing capacity '+str(i),role='user',department='QA',job_title='QA',employee_code='',phone='',office_location='',bio='',allowed_apps='',password_hash='capacity-account-not-for-login',is_active=True) for i,a in enumerate(accounts)])
  db.add(UserRole(user_id=owner,role_id='calendar_sharer'))
  db.add_all([CalendarShare(owner_id=owner,viewer_id=a['id'],share_events=True,share_tasks=True,share_notes=True) for a in accounts[1:201]])
  base=datetime.combine(day,time(9),vn)
  for i in range(13):
   db.add(CalendarEvent(user_id=owner,title='Hidden capacity' if i>=10 else 'Capacity event',starts_at=base+timedelta(minutes=30*i),ends_at=base+timedelta(minutes=30*i+25),is_private=i>=10))
  db.add_all([Task(user_id=owner,title='Capacity deadline',due_date=day.isoformat(),due_time='23:56') for _ in range(10)])
  for i in range(5):
   note=Note(id=str(uuid.uuid4()),user_id=owner,title='Capacity note',content='Private body only loaded in detail');event=CalendarEvent(id=str(uuid.uuid4()),user_id=owner,title=note.title,starts_at=base+timedelta(hours=5,minutes=30*i),ends_at=base+timedelta(hours=5,minutes=30*i+20))
   db.add_all([note,event]);await db.flush();db.add(NoteCalendarSchedule(note_id=note.id,event_id=event.id))
  await db.commit()
 print(json.dumps({'owner':owner,'start':start.isoformat(),'end':(start+timedelta(days=7)).isoformat(),'tokens':[create_access_token({'sub':a['username']}) for a in accounts[1:202]]}))
asyncio.run(main())`;
const cleanup=`import asyncio,json,sys
from sqlalchemy import delete
from app.core.database import async_session_maker
from app.db.models import User
from app.db.task_reminders import TaskReminderReceipt
async def main():
 accounts=json.load(sys.stdin)
 async with async_session_maker() as db:
  await db.execute(delete(User).where(User.id.in_([a['id'] for a in accounts]),User.username.in_([a['username'] for a in accounts]),User.username.like('sharingload_%')))
  await db.commit()
asyncio.run(main())`;
(async()=>{let initialized=false;try{
 initialized=true;const fixture=python(setup),url=new URL('/api/calendar-sharing/view/'+fixture.owner,origin);url.search=new URLSearchParams({start:fixture.start,end:fixture.end}).toString();
 const statuses={},latencies=[];let valid=0;const started=performance.now();
 await Promise.all(fixture.tokens.slice(0,200).map(async token=>{const begin=performance.now();try{const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});const body=await response.json();statuses[response.status]=(statuses[response.status]||0)+1;if(response.status===200&&body.total===25&&body.items.length===25&&!body.items.some(item=>item.title==='Hidden capacity'||'content'in item))valid++;}catch(error){statuses.network_error=(statuses.network_error||0)+1;}finally{latencies.push(performance.now()-begin);}}));
 const elapsed=performance.now()-started;latencies.sort((a,b)=>a-b);
 const denied=await fetch(url,{headers:{Authorization:'Bearer '+fixture.tokens[200]},signal:AbortSignal.timeout(15000)});await denied.arrayBuffer();
 console.log(JSON.stringify({accounts:300,concurrent_readers:200,statuses,valid_readers:valid,total_ms:Math.round(elapsed),p50_ms:Math.round(latencies[99]),p95_ms:Math.round(latencies[189]),max_ms:Math.round(latencies[199]),unshared_account_denied:denied.status===404}));
 assert.equal(valid,200);assert.equal(denied.status,404);
}finally{if(initialized){for(let i=0;i<3;i++){try{python(cleanup);break;}catch(error){if(i===2)throw error;await new Promise(resolve=>setTimeout(resolve,1500));}}}}})().catch(error=>{console.error(error.message);process.exitCode=1;});
