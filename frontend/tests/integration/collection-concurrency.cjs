const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
(async () => {
 const fixture = createTestUsers(1);
 try {
  const base = 'http://127.0.0.1:8000/api';
  const login = await fetch(base + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(fixture.accounts[0]) });
  const session = await login.json(); assert.equal(login.status,200);
  const headers = {Authorization:`Bearer ${session.access_token}`, 'Content-Type':'application/json'};
  const send = (method, path, payload) => fetch(base + path, { method, headers, body:payload === undefined ? undefined : JSON.stringify(payload) });
  assert.equal((await send('PUT','/auth/profile',{full_name:'Committed QA'})).status,200);
  assert.equal((await (await send('GET','/auth/me')).json()).full_name,'Committed QA');
  const task = await (await send('POST','/tasks',{title:'Task race'})).json();
  const tasks = await Promise.all(['A','B'].map(title => send('PATCH','/tasks/'+task.id,{title,expected_version:task.version})));
  assert.deepEqual(tasks.map(r=>r.status).sort(),[200,409]);
  const input = {title:'Event race',starts_at:'2026-10-16T09:00:00+07:00',ends_at:'2026-10-16T10:00:00+07:00'};
  const event = await (await send('POST','/calendar/events',input)).json();
  const events = await Promise.all(['A','B'].map(title => send('PUT','/calendar/events/'+event.id,{...input,title,expected_updated_at:event.updated_at})));
  assert.deepEqual(events.map(r=>r.status).sort(),[200,409]);
  const ids=[]; for(let i=0;i<3;i++) ids.push((await (await send('POST','/notes',{title:'Note '+i})).json()).id);
  const snapshot = await (await send('GET','/notes/'+ids[0])).json();
  const edits = await Promise.all(['A','B'].map(title=>send('PATCH','/notes/'+ids[0],{title,expected_version:snapshot.version})));
  assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  const result = await (await send('GET','/notes/collection/page')).json(); assert.equal(new Set(result.items.map(n=>n.id)).size,3);
  const allDay = await (await send('POST','/tasks',{title:'All day',due_date:'2026-10-15',priority:'LOW'})).json();
  const midnight = await (await send('POST','/tasks',{title:'Midnight',due_date:'2026-10-16',due_time:'00:00',priority:'URGENT'})).json();
  const page = await (await send('GET','/tasks/collection')).json();
  assert.ok(page.items.findIndex(n=>n.id===midnight.id)<page.items.findIndex(n=>n.id===allDay.id));
  console.log('PASS: PostgreSQL concurrent Task edits, Event form edits and Notes edits each accept one writer/reject one stale writer; midnight ordering stays correct.');
 } finally { fixture.cleanup(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
