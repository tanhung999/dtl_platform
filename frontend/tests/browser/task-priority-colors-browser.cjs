const {chromium}=require('../.browser-tools/node_modules/playwright');
const {createTestUsers}=require('../support/test-users.cjs');
const assert=require('node:assert/strict');
const catalog=require('../../src/theme/catalog.json');
const base=process.env.PLATFORM_BASE_URL||'http://127.0.0.1:5173';
const levels=['URGENT','MEDIUM','LOW'];
const labels=['Gấp','Trung bình','Thấp'];
const color=locator=>locator.evaluate(el=>getComputedStyle(el).color);
(async()=>{const fixture=createTestUsers(1);let browser;try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1050}});
 await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());
 await page.goto(base);await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
 await page.getByLabel('Mật khẩu',{exact:true}).fill(fixture.accounts[0].password);
 await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();await page.locator('.workspace-home').waitFor();
 const tasks=await page.evaluate(async levels=>{
  const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
  return Promise.all(levels.map(async priority=>{const r=await fetch('/api/tasks',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('dtl_platform_token'),'Content-Type':'application/json'},body:JSON.stringify({title:'Priority '+priority,priority,due_date:day})});if(!r.ok)throw new Error(await r.text());return r.json();}));
 },levels);
 const nav=page.getByRole('navigation',{name:'Điều hướng chính'});
 const go=label=>nav.getByRole('button',{name:label,exact:true}).click();
 for(const theme of Object.keys(catalog.themes)){
  await page.getByRole('button',{name:'Chọn giao diện',exact:true}).click();await page.locator(`[data-choice="${theme}"]`).click();await page.getByRole('button',{name:'Đóng chọn giao diện',exact:true}).click();await page.waitForTimeout(300);
  await go('Công việc');const combo=page.getByRole('combobox',{name:'Ưu tiên việc mới'});await combo.click();
  assert.deepEqual(await page.getByRole('listbox').getByRole('option').allTextContents(),labels);
  const colors=[];
  for(let i=0;i<levels.length;i++){
   const option=page.getByRole('listbox').getByRole('option',{name:labels[i],exact:true});
   const optionColor=await color(option.locator('.task-priority-icon'));
   const shape=option.locator('.task-priority-icon');
   if(levels[i]==='MEDIUM')assert.equal(await shape.locator('circle').count(),1);
   else if(levels[i]==='URGENT'){
    assert.equal(await shape.locator('g').getAttribute('fill'),'none');
    assert.match(await shape.locator('path').first().getAttribute('d'),/C/,'rounded warning outline');
    assert.equal(await shape.locator('path').count(),2,'warning outline and exclamation stem');
    assert.equal(await shape.locator('circle').count(),1);
   } else assert.equal(await shape.locator('path').getAttribute('d'),'M3 3H13L8 13Z');
   const badgeColor=await color(page.locator(`[data-task-id="${tasks[i].id}"] .task-priority-icon`));
   assert.equal(badgeColor,levels[i]==='URGENT'?'rgb(255, 255, 255)':optionColor,theme+' To-do '+levels[i]);colors.push(optionColor);
  }
  assert.equal(new Set(colors).size,3,theme+' three distinct priority colors');
  await page.keyboard.press('Escape');assert.equal(await combo.getAttribute('aria-expanded'),'false');
  await go('Trang chủ');
  for(let i=0;i<levels.length;i++)assert.equal(await color(page.locator(`[data-deadline-id="${tasks[i].id}"] .task-priority-icon`)),colors[i],theme+' calendar '+levels[i]);
 }
 await go('Lịch');
 for(let i=0;i<levels.length;i++){
  const row=page.locator(`.calendar-page [data-deadline-id="${tasks[i].id}"]`).first();
  const geometry=await row.evaluate(el=>{const icon=el.querySelector('.task-priority-icon').getBoundingClientRect(),checkbox=el.querySelector('input').getBoundingClientRect(),text=el.querySelector('.calendar-deadline-summary').getBoundingClientRect();return {textDelta:Math.abs(icon.y+icon.height/2-text.y-text.height/2),delta:Math.abs(icon.y+icon.height/2-checkbox.y-checkbox.height/2),width:icon.width,height:icon.height};});
  const startOffset=await row.evaluate(el=>el.querySelector('input').getBoundingClientRect().left - el.getBoundingClientRect().left);
  assert.ok(startOffset>=0 && startOffset<=15,levels[i]+' aligned to start of bar');
  assert.ok(geometry.delta<=.5,levels[i]+' centered with checkbox');assert.ok(geometry.textDelta<=.5,levels[i]+' centered with text');assert.equal(geometry.width,14);assert.equal(geometry.height,14);
  if(levels[i]==='URGENT')assert.equal(await color(row.locator('.task-priority-icon')),'rgb(255, 255, 255)');
 }
 await page.screenshot({path:'.audit-backups/priority-icons-aligned.png',fullPage:true});
 await go('Công việc');const combo=page.getByRole('combobox',{name:'Ưu tiên việc mới'});
 await combo.click();await page.getByRole('listbox').getByRole('option',{name:'Trung bình',exact:true}).click();await combo.press('ArrowUp');await combo.press('Enter');assert.match(await combo.innerText(),/Gấp/);
 await combo.click();await page.keyboard.press('Tab');assert.equal(await combo.getAttribute('aria-expanded'),'false');
 await page.locator(`[data-task-id="${tasks[1].id}"]`).getByRole('button',{name:/^Sửa /}).click();
 const dialog=page.getByRole('dialog',{name:'Chi tiết công việc'});const edit=dialog.getByRole('combobox',{name:'Ưu tiên',exact:true});await edit.click();
 assert.deepEqual(await page.getByRole('listbox').getByRole('option').allTextContents(),labels);await page.getByRole('listbox').getByRole('option',{name:'Thấp',exact:true}).click();
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/tasks/'+tasks[1].id)&&r.request().method()==='PATCH');await dialog.getByRole('button',{name:'Lưu công việc',exact:true}).click();
 const response=await saved;assert.equal(response.status(),200);assert.equal((await response.json()).priority,'LOW');
 console.log('PASS three priority levels; matching triangle/circle shapes and identical colors in dropdown, To-do and calendar across nine themes; keyboard, Escape, Tab and modal save.');
}finally{if(browser)await browser.close();fixture.cleanup();}})().catch(error=>{console.error(error);process.exitCode=1;});
