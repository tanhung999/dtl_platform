// Kiểm tra tranh chấp cấp/thu hồi trên PostgreSQL qua API thật.
const { createTestUsers }=require('../support/test-users.cjs');
const { spawnSync }=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
(async()=>{const fixture=createTestUsers(3);try{
 const [owner,viewer,admin]=fixture.accounts;
 const script=`import asyncio,sys
from app.core.database import async_session_maker
from app.db.models import User
from app.db.task_reminders import TaskReminderReceipt
from app.db.access import UserRole
async def main():
 async with async_session_maker() as db:
  db.add_all([UserRole(user_id=sys.argv[1],role_id='calendar_sharer'),UserRole(user_id=sys.argv[2],role_id='access_admin')])
  await db.commit()
asyncio.run(main())`;
 const setup=spawnSync('docker',['compose','exec','-T','platform-backend','python','-c',script,owner.id,admin.id],{cwd:root,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
 const send=async(token,method,url,body)=>{const response=await fetch('http://127.0.0.1:8000/api/'+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});return{status:response.status,body:response.status===204?null:await response.json()};};
 const tokens=await Promise.all(fixture.accounts.map(async account=>{const result=await send(null,'POST','auth/login',{username:account.username,password:account.password});assert.equal(result.status,200);return result.body.access_token;}));
 const base='calendar-sharing/mine/'+viewer.id, scope={share_events:true,share_tasks:false,share_notes:false};
 const creates=await Promise.all(Array.from({length:8},()=>send(tokens[0],'PUT',base,{...scope,expected_version:0})));
 assert.ok(creates.every(result=>result.status===200));assert.equal(new Set(creates.map(result=>result.body.id)).size,1);
 const first=creates[0].body;
 const notices=await send(tokens[1],'GET','notifications?source=platform');assert.equal(notices.body.items.filter(item=>item.kind==='calendar_shared').length,1);
 let current=first;
 for(let round=0;round<8;round++){
  const expected=current.version-1;
  const results=await Promise.all([send(tokens[0],'DELETE',base+`?expected_id=${current.id}&expected_version=${current.version}`),send(tokens[0],'PUT',base,{...scope,expected_id:current.id,expected_version:expected})]);
  assert.equal(results[0].status,204);assert.ok([200,409].includes(results[1].status));
  const received=await send(tokens[1],'GET','calendar-sharing/received');assert.equal(received.body.length,0);
  const old=await send(tokens[0],'PUT',base,{...scope,expected_version:0});assert.equal(old.status,409);
  const state=await send(tokens[0],'GET',base);assert.equal(state.body.active,false);
  const regrant=await send(tokens[0],'PUT',base,{...scope,expected_id:state.body.id,expected_version:state.body.version});assert.equal(regrant.status,200);current=regrant.body;
 }
 const account=(await send(tokens[2],'GET','access/users/'+owner.id)).body;
 const revoke={enabled:false,expected_enabled:true,expected_version:account.access_version};
 const revokes=await Promise.all([send(tokens[2],'PUT','access/users/'+owner.id+'/calendar-sharing',revoke),send(tokens[2],'PUT','access/users/'+owner.id+'/calendar-sharing',revoke)]);
 assert.ok(revokes.every(result=>result.status===200));assert.equal(revokes[0].body.access_version,revokes[1].body.access_version);
 assert.equal((await send(tokens[1],'GET','calendar-sharing/received')).body.length,0);
 const enabled=await send(tokens[2],'PUT','access/users/'+owner.id+'/calendar-sharing',{enabled:true,expected_enabled:false,expected_version:revokes[0].body.access_version});assert.equal(enabled.status,200);
 assert.equal((await send(tokens[2],'PUT','access/users/'+owner.id+'/calendar-sharing',revoke)).status,409);
 assert.equal((await send(tokens[1],'GET','calendar-sharing/received')).body.length,0);
 console.log('PASS: PostgreSQL parallel creates, revoke/retry races, deliberate regrant, role ABA and duplicate notifications');
}finally{for(let attempt=0;attempt<3;attempt++){try{fixture.cleanup();break;}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1500));}}}})().catch(error=>{console.error(error);process.exitCode=1;});
