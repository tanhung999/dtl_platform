// API thật + SSE: Calendar thông thường không làm widget Notes tải lại.
const {chromium}=require('../.browser-tools/node_modules/playwright');
const {createTestUsers}=require('../support/test-users.cjs');
const assert=require('node:assert/strict');
(async()=>{const fixture=createTestUsers(1);let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();page.setDefaultTimeout(20000);
 await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);await page.getByLabel('Mật khẩu',{exact:true}).fill(fixture.accounts[0].password);await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();
 await page.getByText('Chưa có ghi chú nào. Bấm Thêm để tạo ghi chú đầu tiên.',{exact:true}).waitFor();
 const token=await page.evaluate(()=>localStorage.getItem('dtl_platform_token'));
 const api=async(method,path,body)=>{const response=await page.request.fetch('http://127.0.0.1:5173/api/'+path,{method,headers:{Authorization:'Bearer '+token},data:body});assert.ok(response.ok(),path+' '+response.status());return response.status()===204?null:response.json();};
 const eventBody={title:'Ordinary event',starts_at:'2030-10-19T09:00:00+07:00',ends_at:'2030-10-19T10:00:00+07:00',is_all_day:false};
 const note=await api('POST','notes',{title:'Scheduled note',calendar_schedule:{starts_at:eventBody.starts_at,ends_at:eventBody.ends_at,is_all_day:false}});
 await page.locator('.note-card').filter({hasText:'Scheduled note'}).waitFor();
 let reads=0;page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname==='/api/notes/collection/page')reads++;});
 await page.evaluate(()=>{window.__calendarFrames=[];window.addEventListener('workspace:changed',event=>window.__calendarFrames.push(event.detail));});
 const mutate=async(method,path,body,linked)=>{
  const start=await page.evaluate(()=>window.__calendarFrames.length),before=reads;
  const value=await api(method,path,body);
  await page.waitForFunction(index=>window.__calendarFrames.slice(index).some(topics=>topics.includes('calendar')),start);
  if(linked)await page.waitForFunction(index=>window.__calendarFrames.slice(index).some(topics=>topics.includes('notes')),start);
  // Quiet window covers the coalescing timer; commit order is gated by the API/SSE above.
  await page.waitForTimeout(250);
  assert.equal(reads,before+(linked?1:0),method+' '+path+' unexpected Notes reads');return value;
 };
 const put=(row,changes)=>({...Object.fromEntries(['title','description','location','starts_at','ends_at','is_all_day','color','is_private'].map(key=>[key,row[key]])),...changes,expected_updated_at:row.updated_at});
 let ordinary=await mutate('POST','calendar/events',eventBody,false);
 ordinary=await mutate('PUT','calendar/events/'+ordinary.id,put(ordinary,{title:'Renamed ordinary event'}),false);
 ordinary=await mutate('PUT','calendar/events/'+ordinary.id,put(ordinary,{ends_at:'2030-10-19T10:30:00+07:00'}),false);
 await mutate('DELETE','calendar/events/'+ordinary.id+'?expected_updated_at='+encodeURIComponent(ordinary.updated_at),undefined,false);
 let linked=await api('GET','calendar/events/'+note.calendar_schedule.event_id);
 linked=await mutate('PUT','calendar/events/'+linked.id,put(linked,{title:'Renamed linked appointment'}),true);
 await page.locator('.note-event-name').filter({hasText:'Renamed linked appointment'}).waitFor();
 linked=await mutate('PUT','calendar/events/'+linked.id,put(linked,{ends_at:'2030-10-19T11:00:00+07:00'}),true);
 linked=await mutate('PUT','calendar/events/'+linked.id,put(linked,{is_private:true}),true);
 await mutate('DELETE','calendar/events/'+linked.id+'?expected_updated_at='+encodeURIComponent(linked.updated_at),undefined,true);
 assert.equal(await page.locator('.note-event-summary').count(),0);assert.equal(await page.locator('.note-card').filter({hasText:'Scheduled note'}).count(),1);
 console.log('PASS: ordinary create/edit/time/delete cause zero Notes reloads; linked edit/time/privacy/delete each refresh Notes once and preserve the note.');
}finally{await browser?.close();fixture.cleanup();}})().catch(error=>{console.error(error);process.exitCode=1;});
