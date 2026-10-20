const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const fixture = createTestUsers(3); let browser;
 try {
  const script = `import asyncio,sys
from app.core.database import async_session_maker
from app.db.access import UserRole
from app.db.task_reminders import TaskReminderReceipt
async def main():
 async with async_session_maker() as db:
  db.add(UserRole(user_id=sys.argv[1], role_id='access_admin'))
  await db.commit()
asyncio.run(main())`;
  const result=spawnSync('docker',['compose','exec','-T','platform-backend','python','-c',script,fixture.accounts[0].id],{cwd:path.resolve(__dirname,'../../..'),encoding:'utf8'}); assert.equal(result.status,0,result.stderr);
  browser=await chromium.launch({channel:'msedge',headless:true}); const errors=[];
  const login = async account => { const page=await browser.newPage({viewport:{width:1500,height:1100}}); await page.clock.install({time:new Date('2026-10-18T12:00:00+07:00')}); page.setDefaultTimeout(20000); page.on('pageerror',e=>errors.push(e.message)); await page.goto('http://127.0.0.1:5173', {waitUntil:'domcontentloaded',timeout:60000}); await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username); await page.getByLabel('Mật khẩu',{exact:true}).fill(account.password); await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click(); await page.locator('.calendar-widget').waitFor(); await page.getByRole('button',{name:'Lịch',exact:true}).click(); return page; };
  const api=(page,method,url,body)=>page.evaluate(async({method,url,body})=>{const r=await fetch('/api/'+url,{method,headers:{Authorization:'Bearer '+localStorage.getItem('dtl_platform_token'),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}); if(!r.ok)throw Error(await r.text()); return r.status===204?null:r.json();},{method,url,body});
  const owner=await login(fixture.accounts[1]), viewer=await login(fixture.accounts[2]), admin=await login(fixture.accounts[0]);
  assert.equal(await owner.getByRole('button',{name:'Chia sẻ lịch',exact:true}).count(),0);
  assert.equal(await owner.getByRole('button',{name:'Quản trị',exact:true}).count(),0);
  assert.equal(await admin.getByRole('button',{name:'Quyền chia sẻ lịch',exact:true}).count(),0);
  assert.deepEqual(await admin.locator('.nav-tabs-pill button').allTextContents(), ['Workspace','Lịch','Profile','Quản trị']);
  await admin.getByRole('button',{name:'Quản trị',exact:true}).click(); let dialog=admin.locator('.admin-page'); await dialog.getByRole('heading',{name:'Phân quyền tài khoản',exact:true}).waitFor();
  const clock = admin.locator('.nav-clock-time'); const originalTime = await clock.innerText();
  await admin.waitForFunction(previous=>document.querySelector('.nav-clock-time').textContent!==previous,originalTime);
  const measures = await admin.evaluate(async()=>{ await document.fonts.ready; const clock=document.querySelector('.nav-clock-time'), nav=document.querySelector('.nav-tabs-pill'); const values=[]; for(const time of ['11:11:11','23:59:59','00:00:00']) { clock.textContent=time; const n=nav.getBoundingClientRect(), c=clock.getBoundingClientRect(); values.push({x:n.x,width:n.width,clock:c.width}); } return values; });
  for(const value of measures) { assert.ok(Math.abs(value.x-measures[0].x)<.1); assert.ok(Math.abs(value.width-measures[0].width)<.1); assert.ok(Math.abs(value.clock-measures[0].clock)<.1); }

  let lostRoleReply=0;const roleRoute='**/api/access/users/'+fixture.accounts[1].id+'/calendar-sharing';
  const loseRole=async route=>{if(route.request().method()==='PUT'&&lostRoleReply===0){lostRoleReply++;await route.fetch();await route.abort('failed');}else await route.continue();};await admin.route(roleRoute,loseRole);
  await dialog.getByPlaceholder('Nhập ít nhất 2 ký tự tên hoặc tài khoản').fill(fixture.accounts[1].username); await dialog.locator('.sharing-account-results button').filter({hasText:fixture.accounts[1].username}).click(); await dialog.getByRole('button',{name:'Cho phép chia sẻ lịch',exact:true}).click(); await dialog.getByRole('button',{name:'Thu hồi quyền chia sẻ',exact:true}).waitFor();
  await admin.unroute(roleRoute,loseRole);assert.equal(lostRoleReply,1);
  await dialog.locator('.access-history li').filter({hasText:'Cấp quyền chia sẻ lịch'}).waitFor();
  await admin.screenshot({path:path.resolve(__dirname,'../.browser-tools/admin-permissions.png'),fullPage:true});
  await admin.setViewportSize({width:390,height:844}); assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); await admin.setViewportSize({width:1500,height:1100});

  await owner.getByRole('button',{name:'Chia sẻ lịch',exact:true}).waitFor();
  await owner.getByRole('button',{name:'Tạo sự kiện',exact:true}).click(); let eventDialog=owner.getByRole('dialog',{name:'Tạo sự kiện mới'}); await eventDialog.waitFor(); assert.equal(await eventDialog.getByRole('switch',{name:'Sự kiện riêng tư'}).isChecked(),false); await eventDialog.getByRole('button',{name:'Đóng',exact:true}).click();
  const event=await api(owner,'POST','calendar/events',{title:'Shared public event',starts_at:'2026-10-18T09:00:00+07:00',ends_at:'2026-10-18T10:00:00+07:00'});
  await api(owner,'POST','calendar/events',{title:'Never expose private',is_private:true,starts_at:'2026-10-18T11:00:00+07:00',ends_at:'2026-10-18T12:00:00+07:00'});
  await api(owner,'POST','tasks',{title:'Shared dated task',due_date:'2026-10-18'});
  await api(owner,'POST','tasks',{title:'Never expose undated'});
  await api(owner,'POST','notes',{title:'Shared scheduled note',content:'Note body only in details',color:'#fef08a',calendar_schedule:{starts_at:'2026-10-18T13:00:00+07:00',ends_at:'2026-10-18T13:30:00+07:00',is_all_day:false}});
  let lostShareReply=0;const shareRoute='**/api/calendar-sharing/mine/'+fixture.accounts[2].id;
  const loseShare=async route=>{if(route.request().method()==='PUT'&&lostShareReply===0){lostShareReply++;await route.fetch();await route.abort('failed');}else await route.continue();};await owner.route(shareRoute,loseShare);
  await owner.getByRole('button',{name:'Chia sẻ lịch',exact:true}).click(); dialog=owner.getByRole('dialog',{name:'Chia sẻ lịch',exact:true});
  await dialog.getByPlaceholder('Nhập ít nhất 2 ký tự tên hoặc tài khoản').fill(fixture.accounts[2].username); await dialog.locator('.sharing-account-results button').click();
  assert.equal(await dialog.getByRole('checkbox',{name:/Sự kiện/}).isChecked(),true); assert.equal(await dialog.getByRole('checkbox',{name:/Việc cần làm/}).isChecked(),false); await dialog.getByRole('checkbox',{name:/Việc cần làm/}).check(); await dialog.getByRole('checkbox',{name:/Ghi chú/}).check(); await dialog.getByRole('button',{name:'Chia sẻ',exact:true}).click(); await dialog.locator('.sharing-person').waitFor(); await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
  await owner.unroute(shareRoute,loseShare);assert.equal(lostShareReply,1);
  await viewer.locator('.calendar-sharing-navigation .sharing-calendar-choice').filter({hasText:'Test QA'}).click(); const shared=viewer.locator('.shared-calendar-page'); await shared.locator('.shared-calendar-item').filter({hasText:'Shared public event'}).waitFor();
  assert.equal(await shared.getByText('Never expose private',{exact:true}).count(),0); assert.equal(await shared.getByText('Never expose undated',{exact:true}).count(),0); assert.equal(await shared.locator('.shared-calendar-item').count(),3);
  const outside = {x:10,y:100};
  for (const [title,label] of [['Shared public event','Sự kiện · Chỉ xem'],['Shared dated task','Việc cần làm · Chỉ xem'],['Shared scheduled note','Ghi chú · Chỉ xem']]) {
    await shared.locator('.shared-calendar-item').filter({hasText:title}).click();
    const detail=viewer.getByRole('dialog',{name:label,exact:true}); await detail.getByRole('heading',{name:title,exact:true}).waitFor();
    await detail.getByRole('heading',{name:title,exact:true}).click(); assert.equal(await detail.isVisible(),true);
    const bounds=await detail.boundingBox();
    await viewer.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await viewer.mouse.down(); await viewer.mouse.move(outside.x,outside.y); await viewer.mouse.up(); assert.equal(await detail.isVisible(),true);
    await viewer.mouse.click(outside.x,outside.y); assert.equal(await detail.isVisible(),true); await viewer.keyboard.press('Escape'); assert.equal(await detail.isVisible(),true); await detail.getByRole('button',{name:'Đóng',exact:true}).click(); await detail.waitFor({state:'hidden'});
  }
  const updated=()=>{const pending=viewer.waitForResponse(response=>response.url().includes('/api/calendar-sharing/view/'+fixture.accounts[1].id+'?')&&response.status()===200,{timeout:60000});pending.catch(()=>{});return pending;};
  let reload=updated(); await api(owner,'POST','calendar/events',{title:'Early event 05:00',starts_at:'2026-10-18T05:00:00+07:00',ends_at:'2026-10-18T05:30:00+07:00'}); await reload;
  await shared.getByRole('button',{name:/mục trong khung giờ 00:00–06:00/}).waitFor();
  await shared.getByRole('checkbox',{name:'Hiện khung giờ đêm'}).check(); await shared.locator('.shared-calendar-item').filter({hasText:'Early event 05:00'}).waitFor();
  reload=updated(); await api(owner,'POST','calendar/events',{title:'Multi-day range',starts_at:'2026-10-17T09:00:00+07:00',ends_at:'2026-10-19T10:00:00+07:00'});await reload;
  const longCard=shared.locator('.shared-calendar-item').filter({hasText:'Multi-day range'}).first(); assert.ok(await longCard.evaluate(node=>node.querySelector('strong').getBoundingClientRect().top-node.getBoundingClientRect().top<20));
  await longCard.click(); const multi=viewer.getByRole('dialog',{name:'Sự kiện · Chỉ xem'}); await multi.getByText('17/10/2026 09:00 – 19/10/2026 10:00',{exact:true}).waitFor();await multi.getByRole('button',{name:'Đóng',exact:true}).click();
  reload=updated();await api(owner,'POST','calendar/events',{title:'Continuous all-day bar',starts_at:'2026-10-10T00:00:00+07:00',ends_at:'2026-10-21T00:00:00+07:00',is_all_day:true});await reload;
  const bar=shared.locator('.calendar-all-day-span').filter({hasText:'Continuous all-day bar'});await bar.waitFor();assert.equal(await bar.count(),1);assert.equal(await bar.locator('[aria-label="Tiếp tục từ tuần trước"]').count(),1);assert.equal(await bar.locator('[aria-label="Tiếp tục sang tuần sau"]').count(),1);
  reload=updated();await api(owner,'POST','tasks',{title:'Timed deadline marker',due_date:'2026-10-18',due_time:'23:56',priority:'HIGH'});await reload;
  const deadline=shared.locator('.shared-calendar-item').filter({hasText:'Timed deadline marker'});await deadline.waitFor();assert.match(await deadline.innerText(),/Hạn 23:56/);assert.ok((await deadline.boundingBox()).height<=26);
  reload=updated();await api(owner,'POST','tasks',{title:'Overdue only once',due_date:'2026-10-17',due_time:'06:00',priority:'LOW'});await reload;const overdue=shared.getByRole('region',{name:'Việc quá hạn được chia sẻ'});await overdue.getByText('Overdue only once',{exact:true}).waitFor();assert.equal(await shared.locator('.calendar-week-scroll .shared-calendar-item').filter({hasText:'Overdue only once'}).count(),1);
  await shared.locator('.shared-calendar-item').filter({hasText:'Shared public event'}).click();const retained=viewer.getByRole('dialog',{name:'Sự kiện · Chỉ xem'});await retained.getByRole('heading',{name:'Shared public event',exact:true}).waitFor();
  reload=updated();await api(owner,'POST','notes',{title:'Unrelated unscheduled note'});await reload;assert.equal(await retained.isVisible(),true);await retained.getByRole('button',{name:'Đóng',exact:true}).click();
  const scroll=shared.locator('.calendar-week-scroll');await scroll.evaluate(node=>node.scrollTop=480);
  reload=updated();await api(owner,'POST','notes',{title:'Another unrelated unscheduled note'});await reload;assert.ok(Math.abs((await scroll.evaluate(node=>node.scrollTop))-480)<1);
  await shared.locator('.shared-calendar-item').filter({hasText:'Shared scheduled note'}).click(); const noteDialog=viewer.getByRole('dialog',{name:'Ghi chú · Chỉ xem'}); await noteDialog.getByText('Note body only in details').waitFor(); assert.equal(await noteDialog.locator('textarea,input,button[type=submit]').count(),0); await noteDialog.getByRole('button',{name:'Đóng',exact:true}).click();
  await viewer.screenshot({path:path.resolve(__dirname,'../.browser-tools/calendar-sharing-readonly.png'),fullPage:true});
  await viewer.getByRole('button',{name:'Tháng',exact:true}).click(); await shared.locator('.shared-month-grid').waitFor(); await viewer.getByRole('button',{name:'Danh sách',exact:true}).click(); await shared.locator('.shared-agenda').waitFor();
  for (const [resource,title,label] of [['tasks','Shared dated task','Việc cần làm · Chỉ xem'],['notes','Shared scheduled note','Ghi chú · Chỉ xem']]) {
    const record=(await api(owner,'GET',resource)).find(row=>row.title===title);assert.ok(record);
    await shared.locator('.shared-calendar-item').filter({hasText:title}).click();const detail=viewer.getByRole('dialog',{name:label});await detail.getByRole('heading',{name:title,exact:true}).waitFor();
    await api(owner,'PATCH',resource+'/'+record.id,{expected_version:record.version,is_private:true});await detail.waitFor({state:'hidden'});await shared.locator('.shared-calendar-item').filter({hasText:title}).waitFor({state:'hidden'});
    const latest=await api(owner,'GET',resource+'/'+record.id);await api(owner,'PATCH',resource+'/'+record.id,{expected_version:latest.version,is_private:false});await shared.locator('.shared-calendar-item').filter({hasText:title}).waitFor();
  }
  await shared.locator('.shared-calendar-item').filter({hasText:'Shared public event'}).click();await viewer.getByRole('dialog',{name:'Sự kiện · Chỉ xem'}).getByRole('heading',{name:'Shared public event',exact:true}).waitFor();
  const current=await api(owner,'GET','calendar/events/'+event.id); const {id,user_id,created_at,updated_at,scheduled_note_id,...body}=current; await api(owner,'PUT','calendar/events/'+event.id,{...body,is_private:true,expected_updated_at:updated_at});
  await viewer.getByRole('dialog',{name:'Sự kiện · Chỉ xem'}).waitFor({state:'hidden'});
  await viewer.waitForFunction(()=>!document.querySelector('.shared-calendar-page')?.textContent.includes('Shared public event'));
  await owner.getByRole('button',{name:'Chia sẻ lịch',exact:true}).click(); dialog=owner.getByRole('dialog',{name:'Chia sẻ lịch',exact:true}); await dialog.locator('.sharing-person').getByRole('button',{name:'Sửa',exact:true}).click(); await dialog.getByRole('checkbox',{name:/Ghi chú/}).uncheck(); await dialog.getByRole('button',{name:'Lưu thay đổi',exact:true}).click(); await dialog.locator('.sharing-editor').waitFor({state:'hidden'}); await viewer.waitForFunction(()=>!document.querySelector('.shared-calendar-page')?.textContent.includes('Shared scheduled note'));
  const revokeRoute=url=>url.pathname==='/api/calendar-sharing/mine/'+fixture.accounts[2].id;
  let lostRevokeReply=0;const loseRevoke=async route=>{if(route.request().method()==='DELETE'&&lostRevokeReply===0){lostRevokeReply++;await route.fetch();await route.abort('failed');}else await route.continue();};await owner.route(revokeRoute,loseRevoke);
  await dialog.locator('.sharing-person').getByRole('button',{name:'Thu hồi',exact:true}).click(); await dialog.getByRole('button',{name:'Thu hồi quyền xem',exact:true}).click(); await viewer.locator('.shared-calendar-page').waitFor({state:'hidden'}); await viewer.getByText('Lịch không còn được chia sẻ với bạn.',{exact:true}).waitFor();
  await owner.unroute(revokeRoute,loseRevoke);assert.equal(lostRevokeReply,1);
  await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
  await owner.getByRole('button',{name:'Chia sẻ lịch',exact:true}).click();dialog=owner.getByRole('dialog',{name:'Chia sẻ lịch',exact:true});await dialog.getByPlaceholder('Nhập ít nhất 2 ký tự tên hoặc tài khoản').fill(fixture.accounts[2].username);await dialog.locator('.sharing-account-results button').click();assert.equal(await dialog.getByRole('checkbox',{name:/Việc cần làm/}).isChecked(),false);await dialog.getByRole('button',{name:'Chia sẻ',exact:true}).click();await dialog.locator('.sharing-person').waitFor();await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
  await viewer.locator('.calendar-sharing-navigation .sharing-calendar-choice').filter({hasText:'Test QA'}).click();await viewer.locator('.shared-calendar-page').waitFor();
  const adminPage=admin.locator('.admin-page');await adminPage.getByRole('button',{name:'Thu hồi quyền chia sẻ',exact:true}).click();await adminPage.getByRole('button',{name:'Xác nhận thu hồi',exact:true}).click();await adminPage.getByRole('button',{name:'Cho phép chia sẻ lịch',exact:true}).waitFor();await owner.getByRole('button',{name:'Chia sẻ lịch',exact:true}).waitFor({state:'hidden'});await viewer.locator('.shared-calendar-page').waitFor({state:'hidden'});
  await adminPage.getByRole('button',{name:'Cho phép chia sẻ lịch',exact:true}).click();await owner.getByRole('button',{name:'Chia sẻ lịch',exact:true}).waitFor();
  assert.equal((await api(viewer,'GET','calendar-sharing/received')).length,0);
  assert.deepEqual(errors,[]); console.log('PASS: lost-response reconciliation, night hours, multi-day details and bars, deadline markers, stable realtime dialog/scroll, fresh regrant and audit, X-only dismissal and safe text selection, admin navigation, fixed clock layout, responsive permissions page, explicit assignment, share scopes/defaults, private filtering, read-only notes, three views, realtime privacy/scope/revoke');
 } catch(error) { if(browser){for(const [index,context]of browser.contexts().entries()){for(const page of context.pages()){console.log('DEBUG_DIALOGS',index,await page.evaluate(()=>({dialogs:[...document.querySelectorAll('dialog')].map(node=>({open:node.open,title:node.getAttribute('aria-label')}))})));await page.screenshot({path:path.resolve(__dirname,'../.browser-tools/sharing-failure-'+index+'.png'),fullPage:true});}}}throw error; } finally { if(browser) await browser.close(); for(let attempt=0;attempt<3;attempt++){try{fixture.cleanup();break;}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1500));}} }
})().catch(e=>{console.error(e);process.exitCode=1;});
