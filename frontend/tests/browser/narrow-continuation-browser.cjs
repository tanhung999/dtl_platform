const {chromium}=require('../.browser-tools/node_modules/playwright');
const {createTestUsers}=require('../support/test-users.cjs');const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');const path=require('node:path');
const base=process.env.PLATFORM_BASE_URL||'http://127.0.0.1:5173';
(async()=>{const fixture=createTestUsers(2);let browser;try{
 const seed=spawnSync('docker',['compose','exec','-T','platform-backend','python','-c',`import asyncio,json,sys
from app.core.database import async_session_maker
from app.db.models import User
from app.db.access import UserRole
async def run():
    accounts=json.load(sys.stdin)
    async with async_session_maker() as db:
        for account in accounts:
            user=await db.get(User,account['id']);assert user and user.username==account['username'] and user.username.startswith('testqa_')
        db.add(UserRole(user_id=accounts[0]['id'],role_id='calendar_sharer'))
        await db.commit()
asyncio.run(run())`],{cwd:path.resolve(__dirname,'../../..'),input:JSON.stringify(fixture.accounts),encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);
 browser=await chromium.launch({channel:'msedge',headless:true});
 const errors=[];
 async function login(account){const page=await browser.newPage({viewport:{width:1550,height:1050}});page.on('pageerror',e=>errors.push(e.message));await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await page.goto(base);await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username);await page.getByLabel('Mật khẩu',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();await page.locator('.workspace-home').waitFor();assert.deepEqual(await page.getByRole('navigation',{name:'Điều hướng chính'}).locator('button').evaluateAll(nodes=>nodes.slice(0,4).map(node=>node.textContent.trim())),['Trang chủ','DT Platform','DT Calendar','DT Task']);return page;}
 const owner=await login(fixture.accounts[0]);const token=await owner.evaluate(()=>localStorage.getItem('dtl_platform_token'));
 async function write(method,url,data){const r=await owner.request.fetch(base+url,{method,headers:{Authorization:`Bearer ${token}`},data});assert.ok(r.ok(),await r.text());return r.json();}
 await write('PUT','/api/calendar-sharing/mine/'+fixture.accounts[1].id,{expected_version:0,share_events:true,share_tasks:true,share_notes:true});
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());const day=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const schedule={starts_at:day(-1)+'T11:00:00+07:00',ends_at:day(1)+'T13:00:00+07:00',is_all_day:false};
 const event=await write('POST','/api/calendar/events',{title:'Continuing event QA',...schedule});
 const note=await write('POST','/api/notes',{title:'Continuing note QA',calendar_schedule:schedule});
 for(let i=0;i<8;i++)await write('POST','/api/calendar/events',{title:'Crowded '+i,...schedule});
 const allDaySchedule={starts_at:day(-10)+'T00:00:00+07:00',ends_at:day(10)+'T00:00:00+07:00',is_all_day:true};
 const allDayEvent=await write('POST','/api/calendar/events',{title:'All-day continuing event QA',...allDaySchedule});
 const allDayNote=await write('POST','/api/notes',{title:'All-day continuing note QA',calendar_schedule:allDaySchedule});
 await write('POST','/api/calendar/events',{title:'Partial-week colors QA',starts_at:today+'T00:00:00+07:00',ends_at:day(2)+'T00:00:00+07:00',is_all_day:true});
 await write('POST','/api/notes',{title:'Partial-week note colors QA',calendar_schedule:{starts_at:day(-1)+'T00:00:00+07:00',ends_at:day(1)+'T00:00:00+07:00',is_all_day:true}});
 async function checkSegmentColumns(page){
  for(const width of [1900,1550,1373,980,790]){
   await page.setViewportSize({width,height:1050});
   const layout=await page.locator('.calendar-page').evaluate(el=>{
    const sidebar=el.querySelector('.calendar-sidebar'),rect=sidebar.getBoundingClientRect();
    const children=[...sidebar.querySelectorAll('.calendar-mini-heading, .calendar-mini-grid button, .calendar-create-button')];
    const frames=[...el.querySelectorAll('.calendar-time-column')];
    const shell=el.querySelector('.calendar-shell'),main=el.querySelector('.calendar-main');
    return {zoom:getComputedStyle(main).zoom,shellWidth:shell.getBoundingClientRect().width,available:el.clientWidth-parseFloat(getComputedStyle(el).paddingLeft)-parseFloat(getComputedStyle(el).paddingRight),hourHeight:el.querySelector('.calendar-time-slot').getBoundingClientRect().height,sidebar:rect.width,pagePadding:parseFloat(getComputedStyle(el).paddingLeft),overflow:children.some(node=>{const r=node.getBoundingClientRect();return r.left<rect.left-.5 || r.right>rect.right+.5;}),gutters:frames.every(column=>[...column.querySelectorAll(':scope > .calendar-event, :scope > .calendar-timed-deadline, :scope > .shared-timed-frame')].every(node=>{const a=node.getBoundingClientRect(),b=column.getBoundingClientRect();return a.left>=b.left+2.7 && a.right<=b.right-2.7;}))};
   });
   assert.ok(Math.abs(layout.sidebar-(width<=1100?167.2:193.6))<.1,JSON.stringify({width,layout}));assert.equal(Number(layout.zoom),.84);assert.ok(Math.abs(layout.shellWidth-layout.available)<1,JSON.stringify({width,layout}));assert.ok(Math.abs(layout.hourHeight-50.4)<.1,JSON.stringify({width,layout}));assert.equal(layout.pagePadding,12);assert.equal(layout.overflow,false,JSON.stringify({width,layout}));assert.equal(layout.gutters,true,JSON.stringify({width,layout}));
   const results=await page.locator('.calendar-all-day-segments').evaluateAll(nodes=>nodes.map(node=>{
    const frame=node.closest('.calendar-all-day-event-frame'),grid=node.closest('.calendar-week-all-day');
    const start=parseInt(frame.style.gridColumn,10)-2,cells=[...grid.querySelectorAll(':scope > .calendar-all-day-background')];
    return [...node.children].map((segment,index)=>{const rect=segment.getBoundingClientRect(),cell=cells[start+index].getBoundingClientRect();return Math.max(Math.abs(rect.left-cell.left),Math.abs(rect.right-cell.right));});
   }));
   assert.ok(results.length>=3,'visible full-week and partial-week event/note bars');
   assert.ok(results.flat().every(delta=>delta<=.6),JSON.stringify({width,results}));
  }
  const allDay=page.locator('.calendar-week-all-day');
  assert.ok(await allDay.evaluate(el=>[...el.children].filter(node=>node.matches('.calendar-all-day-event-frame, .calendar-all-day-placement')).every(node=>parseInt(node.style.gridRow,10)<=3)),'at most three visible all-day rows');
  assert.ok(await allDay.locator('.calendar-more').count()>0,'overflow items have a show-more action');
  assert.equal(await page.locator('.platform-footer').isVisible(),false);
  await page.setViewportSize({width:1550,height:1050});
 }

 const completed=await write('POST','/api/tasks',{title:'Completed style QA',due_date:today,due_time:'15:00'});await write('PATCH','/api/tasks/'+completed.id,{is_completed:true,expected_version:completed.version});
 const urgent=await write('POST','/api/tasks',{title:'Shared urgent contrast QA',due_date:today,due_time:'15:00',priority:'URGENT'});
 await write('POST','/api/tasks',{title:'Collapsed overdue QA',due_date:day(-1),priority:'LOW'});
 const midnight=await write('POST','/api/calendar/events',{title:'Exact midnight QA',starts_at:today+'T18:00:00+07:00',ends_at:day(1)+'T00:00:00+07:00',is_all_day:false});
 await owner.getByRole('navigation',{name:'Điều hướng chính'}).getByRole('button',{name:'DT Calendar',exact:true}).click();await owner.getByRole('button',{name:'Tuần',exact:true}).click();
 for(const id of [allDayEvent.id,allDayNote.calendar_schedule.event_id]){const bar=owner.locator(`.calendar-all-day-event-frame button[data-event-id="${id}"]`);await bar.waitFor();assert.equal(await bar.locator('.calendar-continuation-marker.is-inline').count(),2);assert.equal(await bar.getByRole('img',{name:'Tiếp tục từ tuần trước',exact:true}).count(),1);assert.equal(await bar.getByRole('img',{name:'Tiếp tục sang tuần sau',exact:true}).count(),1);assert.equal(await bar.locator('.calendar-continuation-marker svg path').count(),2);assert.ok(await bar.locator('.calendar-continuation-marker.is-start path').evaluate(el=>{const box=el.getBBox();return box.width>box.height;}));}
 async function checkOverdue(page,shared=false){
  const section=page.locator(shared?'.shared-overdue-group':'.calendar-overdue-compact');
  await section.waitFor();const button=section.locator('button[aria-expanded]');
  assert.equal(await button.getAttribute('aria-expanded'),'false');assert.equal(await section.locator('.calendar-overdue-list, .shared-overdue-expanded').count(),0);
  await button.click();await section.locator(shared?'.shared-overdue-line':'.calendar-overdue-task').waitFor();assert.equal(await button.getAttribute('aria-expanded'),'true');
  await button.click();assert.equal(await section.locator('.calendar-overdue-list, .shared-overdue-expanded').count(),0);
 }
 await checkOverdue(owner);
 async function checkScrolling(page){
  await page.setViewportSize({width:1366,height:768});
  const style=await page.addStyleTag({content:'.calendar-timeline-scroll::-webkit-scrollbar { width:12px; } .calendar-timeline-scroll::-webkit-scrollbar-thumb { background:#888; }'});
  await page.locator('.calendar-sidebar').evaluate(el=>{const nav=el.querySelector('.calendar-sharing-navigation');for(let i=0;i<20;i++){const row=nav.querySelector('button').cloneNode(true);row.dataset.layoutFixture='true';nav.append(row);}});
  await page.waitForTimeout(100);
  const before=await page.evaluate(()=>{const timeline=document.querySelector('.calendar-timeline-scroll'),sidebar=document.querySelector('.calendar-sidebar-scroll');
   const bounds=el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom};};
   const heading=document.querySelector('.calendar-week-header');const headerDays=[...heading.children].slice(1),columns=[...document.querySelectorAll('.calendar-time-column')],backgrounds=[...document.querySelectorAll('.calendar-all-day-background')];
   const mismatch=columns.map((column,i)=>Math.max(Math.abs(bounds(column).left-bounds(headerDays[i]).left),Math.abs(bounds(column).right-bounds(headerDays[i]).right),Math.abs(bounds(column).right-bounds(backgrounds[i]).right)));
   return {pageOverflow:document.documentElement.scrollHeight-innerHeight,footer:bounds(document.querySelector('.platform-footer')),header:bounds(heading),allDay:bounds(document.querySelector('.calendar-week-all-day')),timeline:bounds(timeline),sideCanScroll:sidebar.scrollHeight>sidebar.clientHeight,mismatch};});
  assert.ok(before.pageOverflow<=1,JSON.stringify(before));assert.ok(before.footer.bottom<=769);assert.ok(before.sideCanScroll);assert.ok(before.mismatch.every(n=>n<1),JSON.stringify(before));
  const timeline=page.locator('.calendar-timeline-scroll'),sidebar=page.locator('.calendar-sidebar-scroll');await timeline.hover();await page.mouse.wheel(0,350);await page.waitForTimeout(150);
  assert.ok(await timeline.evaluate(el=>el.scrollTop>0));assert.ok(Math.abs(await page.locator('.calendar-week-header').evaluate(el=>el.getBoundingClientRect().top)-before.header.top)<.5);assert.ok(Math.abs(await page.locator('.calendar-week-all-day').evaluate(el=>el.getBoundingClientRect().top)-before.allDay.top)<.5);
  const timeScroll=await timeline.evaluate(el=>el.scrollTop);await sidebar.hover();await page.mouse.wheel(0,650);await page.waitForTimeout(150);assert.ok(await sidebar.evaluate(el=>el.scrollTop>0));assert.equal(await timeline.evaluate(el=>el.scrollTop),timeScroll);assert.equal(await page.evaluate(()=>window.scrollY),0);
  await page.locator('[data-layout-fixture]').evaluateAll(nodes=>nodes.forEach(node=>node.remove()));await sidebar.evaluate(el=>el.scrollTop=0);await style.evaluate(el=>el.remove());await page.setViewportSize({width:1550,height:1050});
 }
 await checkScrolling(owner);
 async function check(card,before,after){await card.waitFor();assert.equal(await card.locator('.calendar-continuation-marker.is-start').count(),before?1:0);assert.equal(await card.locator('.calendar-continuation-marker.is-end').count(),after?1:0);const result=await card.evaluate(el=>{const box=el.getBoundingClientRect();const markers=[...el.querySelectorAll('.calendar-continuation-marker')];return {width:box.width,visible:markers.every(m=>{const r=m.querySelector('svg').getBoundingClientRect();return getComputedStyle(m).visibility==='visible' && r.width>0 && m.querySelector('path').getBoundingClientRect().height>=7.2 && r.left>=box.left && r.right<=box.right+.5 && r.top>=box.top && r.bottom<=box.bottom+.5;}),title:el.dataset.tooltip || ''};});assert.ok(result.visible,JSON.stringify(result));assert.ok(result.width<40,'Reproduce narrow overlapping lanes');assert.ok(result.title.length>15);}
 for(const id of [event.id,note.calendar_schedule.event_id]){
  const card=date=>owner.locator(`.calendar-time-column[data-date="${date}"] [data-event-id="${id}"]`);
  await check(card(day(-1)),false,true);await check(card(today),true,true);await check(card(day(1)),true,false);
 }
 await check(owner.locator(`.calendar-time-column[data-date="${today}"] [data-event-id="${midnight.id}"]`),false,false);
 await checkSegmentColumns(owner);
 await owner.locator('.calendar-timeline-scroll').evaluate(el=>el.scrollTop=0);await owner.screenshot({path:path.resolve(__dirname,'../../../.audit-backups/narrow-continuation-owner.png')});
 const viewer=await login(fixture.accounts[1]);await viewer.getByRole('navigation',{name:'Điều hướng chính'}).getByRole('button',{name:'DT Calendar',exact:true}).click();await viewer.getByRole('button',{name:/Test QA.*Chỉ xem/}).click();await viewer.getByRole('button',{name:'Tuần',exact:true}).click();
 for(const title of ['Continuing event QA','Continuing note QA']){const cards=viewer.locator('.shared-timed-frame .shared-calendar-item').filter({hasText:title});await cards.first().waitFor();assert.equal(await cards.count(),3);await check(cards.nth(0),false,true);await check(cards.nth(1),true,true);await check(cards.nth(2),true,false);}
 for(const title of ['All-day continuing event QA','All-day continuing note QA']){const bar=viewer.locator('.shared-all-day-frame .shared-calendar-item').filter({hasText:title});await bar.waitFor();assert.equal(await bar.locator('.calendar-continuation-marker.is-inline svg path').count(),2);}
 await checkOverdue(viewer,true);
 await checkScrolling(viewer);
 const sharedTask=viewer.locator(`.shared-timed-frame [data-shared-id="${completed.id}"]`);await sharedTask.waitFor();
 const sharedStyle=await sharedTask.evaluate(el=>{const summary=el.querySelector('.shared-deadline-summary');return {strike:getComputedStyle(summary).textDecorationLine,text:summary.textContent,background:getComputedStyle(el).backgroundColor};});assert.equal(sharedStyle.strike,'line-through');assert.match(sharedStyle.text,/15:00/);assert.ok(!sharedStyle.text.includes('Hạn'));assert.equal(sharedStyle.background,'rgb(229, 231, 235)');
 await checkSegmentColumns(viewer);
 for(const theme of Object.keys(require('../../src/theme/catalog.json').themes)){
  await viewer.getByRole('button',{name:'Chọn giao diện',exact:true}).click();await viewer.locator(`[data-choice="${theme}"]`).click();await viewer.getByRole('button',{name:'Đóng chọn giao diện',exact:true}).click();await viewer.waitForTimeout(350);
  for(const id of [urgent.id,completed.id]){
   const contrast=await viewer.locator(`[data-shared-id="${id}"]`).first().evaluate(el=>{
    const ctx=document.createElement('canvas').getContext('2d');
    const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((n,i)=>i===3?n/255:n);};
    const over=(fg,bg)=>fg.slice(0,3).map((n,i)=>n*fg[3]+bg[i]*(1-fg[3])).concat(1);
    const background=node=>node?over(rgba(getComputedStyle(node).backgroundColor),background(node.parentElement)):[255,255,255,1];
    const lum=color=>color.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
    const bg=background(el);return {icon:ratio(rgba(getComputedStyle(el.querySelector('.task-priority-icon')).color),bg),text:ratio(rgba(getComputedStyle(el).color),bg)};
   });
   assert.ok(contrast.icon>=3,JSON.stringify({theme,id,contrast}));assert.ok(contrast.text>=4.5,JSON.stringify({theme,id,contrast}));
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS all-day matching arrow icons and narrow multi-day event/note arrows: first/middle/last day, exact-midnight boundary, actual visible SVG inside 10+ overlapping lanes, personal and shared calendars');
}finally{await browser?.close();fixture.cleanup();}})().catch(e=>{console.error(e);process.exitCode=1;});
