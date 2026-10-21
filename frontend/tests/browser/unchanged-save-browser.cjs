const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
(async () => {
 const fixture = createTestUsers(1); let browser;
 try {
  browser = await chromium.launch({ channel:'msedge', headless:true });
  const page = await browser.newPage({ viewport:{width:1500,height:1100} });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto(process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173');
  await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
  await page.getByLabel('Mật khẩu',{exact:true}).fill(fixture.accounts[0].password);
  await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();
  await page.locator('.calendar-widget').waitFor();
  const api = (method,path,body) => page.evaluate(async ({method,path,body}) => {
   const response=await fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+localStorage.getItem('dtl_platform_token'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   if(!response.ok)throw new Error(await response.text());return response.json();
  },{method,path,body});
  const day=await page.evaluate(()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}));
  const task=await api('POST','tasks',{title:'Noop task',due_date:day});
  const note=await api('POST','notes',{title:'Noop note',content:'  Keep whitespace  ',calendar_schedule:{starts_at:day+'T09:00:00+07:00',ends_at:day+'T10:00:00+07:00'}});
  const event=await api('POST','calendar/events',{title:'Noop event',starts_at:day+'T09:00:25+07:00',ends_at:day+'T10:00:45+07:00'});
  await page.reload();await page.locator('.calendar-widget').waitFor();
  const mutations=[];page.on('request',r=>{if(/\/api\//.test(r.url())&&['POST','PUT','PATCH','DELETE'].includes(r.method()))mutations.push(r.method()+' '+r.url());});
  const noWrite=async (dialog,button) => {const count=mutations.length;await dialog.getByRole('button',{name:button,exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(mutations.length,count);};
  await page.getByRole('button',{name:'Sửa Noop task',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Chi tiết công việc',exact:true});
  await dialog.getByLabel('Tên công việc',{exact:true}).fill('Changed');await dialog.getByLabel('Tên công việc',{exact:true}).fill('Noop task');
  await noWrite(dialog,'Lưu công việc');
  assert.equal((await api('GET','tasks/'+task.id)).version,task.version);
  await page.locator(`[data-note-id="${note.id}"] .note-title`).click();dialog=page.getByRole('dialog',{name:'Ghi chú',exact:true});
  await noWrite(dialog,'Lưu ghi chú');
  const savedNote=await api('GET','notes/'+note.id);assert.equal(savedNote.content,note.content);assert.equal(savedNote.version,note.version);
  await page.locator(`.calendar-widget [data-event-id="${event.id}"]`).click();dialog=page.getByRole('dialog',{name:'Chi tiết sự kiện',exact:true});
  await noWrite(dialog,'Lưu sự kiện');
  assert.equal((await api('GET','calendar/events/'+event.id)).updated_at,event.updated_at);
  await page.locator(`.calendar-widget [data-event-id="${event.id}"]`).click();
  await dialog.getByPlaceholder('Ghi chú cho sự kiện…').fill('Actual edit');
  const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/calendar/events/'+event.id));
  await dialog.getByRole('button',{name:'Lưu sự kiện',exact:true}).click();assert.ok((await saved).ok());await dialog.waitFor({state:'hidden'});
  const updated=await api('GET','calendar/events/'+event.id);assert.equal(updated.starts_at,event.starts_at);assert.equal(updated.ends_at,event.ends_at);assert.equal(updated.description,'Actual edit');
  await page.getByRole('button',{name:'Profile',exact:true}).click();
  const count=mutations.length;await page.getByRole('button',{name:/Lưu.*thay đổi/i}).click();
  await page.getByText('Thông tin chưa thay đổi.',{exact:true}).waitFor();assert.equal(mutations.length,count);
  console.log('PASS: unchanged Task/Note/Event/Profile send no writes; reverting changes closes without saving; real event edit saves once and preserves seconds.');
 } finally { if(browser)await browser.close();fixture.cleanup(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
