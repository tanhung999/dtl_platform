const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const catalog = require('../../src/theme/catalog.json');
(async () => {
 const fixture=createTestUsers(1); let browser;
 try {
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1672,height:1050}});
  await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5175');
  await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
  await page.getByLabel('Mật khẩu',{exact:true}).fill(fixture.accounts[0].password);
  await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();
  await page.locator('.workspace-home').waitFor();
  assert.equal((await page.locator('.workspace-welcome p').textContent()).replace(/\.$/,''),'Một nền tảng thống nhất cho các công cụ và dữ liệu doanh nghiệp');
  assert.equal(await page.locator('.enterprise-app-card').count(),3);
  assert.equal(await page.locator('.workspace-shortcut').count(),3);
  assert.equal(await page.locator('.tasks-widget,.notes-widget').count(),0);
  const nav=page.getByRole('navigation',{name:'Điều hướng chính'});
  assert.equal(await nav.getByRole('link',{name:'Quản trị',exact:true}).count(),0);
  await page.getByRole('button',{name:'Thu gọn thanh điều hướng',exact:true}).click();
  await page.reload();await page.locator('.dashboard-app.sidebar-is-collapsed').waitFor();
  await page.getByRole('button',{name:'Mở rộng thanh điều hướng',exact:true}).click();
  await page.locator('.workspace-shortcuts').getByRole('button',{name:'Ghi chú',exact:true}).click();
  await page.locator('.notes-page').waitFor();
  await page.locator('.notes-widget').getByRole('button',{name:'Thêm',exact:true}).click();
  const note=page.getByRole('dialog',{name:'Ghi chú',exact:true});
  await note.getByPlaceholder('Tiêu đề ghi chú...', {exact:true}).fill('Home note QA');
  await note.getByRole('button',{name:'Lưu ghi chú',exact:true}).click();
  await note.waitFor({state:'hidden'});
  await page.locator('.note-title').filter({hasText:'Home note QA'}).waitFor();
  await page.getByRole('button',{name:'Về trang chủ',exact:true}).click();
  await page.locator('.workspace-shortcuts').getByRole('button',{name:'Công việc',exact:true}).click();
  await page.locator('.tasks-page').waitFor();
  await page.getByLabel('Tên việc mới',{exact:true}).fill('Home task QA');
  await page.getByLabel('Tên việc mới',{exact:true}).press('Enter');
  await page.getByRole('button',{name:'Sửa Home task QA',exact:true}).waitFor();
  await nav.getByRole('link',{name:'DT Platform',exact:true}).click();
  const search=page.getByRole('searchbox',{name:'Tìm kiếm toàn hệ thống'});
  await search.click();
  assert.ok(await search.evaluate(el=>el===document.activeElement));
  await search.fill('trinh ky');await page.locator('.enterprise-app-card').waitFor();assert.equal(await page.locator('.enterprise-app-card').count(),1);
  assert.match(await page.locator('.enterprise-app-card').textContent(),/Workflows/);
  await search.fill('tai san');await page.getByRole('button',{name:'Mở Asset Manager',exact:true}).waitFor();assert.match(await page.locator('.enterprise-app-card').textContent(),/Asset Manager/);
  await search.fill('zzzz');await page.getByText('Không tìm thấy kết quả phù hợp.').waitFor();
  await search.fill('');await page.locator('.workspace-home').waitFor();assert.equal(await search.inputValue(),'');
  assert.equal(await page.locator('.workspace-search kbd').count(),0);
  await page.getByRole('button',{name:'Tạo sự kiện',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:/Đóng/}).last().click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Thông báo',exact:true}).click();
  await page.getByRole('dialog',{name:'Thông báo',exact:true}).waitFor();
  await page.getByRole('button',{name:'Đóng thông báo',exact:true}).click();
  const bookmarks=page.locator('.bookmarks-widget');
  await bookmarks.getByRole('button',{name:'Thêm',exact:true}).click();
  assert.ok(await bookmarks.getByLabel('Tên liên kết').evaluate(el=>el===document.activeElement));
  await bookmarks.getByLabel('Tên liên kết').fill('Home redesign QA');
  await bookmarks.getByLabel('Địa chỉ liên kết').fill('https://example.com');
  await bookmarks.getByRole('button',{name:'Lưu',exact:true}).click();
  await bookmarks.getByRole('link',{name:'Home redesign QA',exact:true}).waitFor();
  await nav.getByRole('button',{name:'DT Link',exact:true}).click();
  await page.getByRole('link',{name:'Home redesign QA',exact:true}).waitFor();
  await page.getByRole('button',{name:'Xóa liên kết Home redesign QA',exact:true}).click();
  await page.getByRole('link',{name:'Home redesign QA',exact:true}).waitFor({state:'hidden'});
  await nav.getByRole('link',{name:'DT Platform',exact:true}).click();
  // Controlled SSO destination avoids contacting an enterprise app during QA.
  await page.route('**/api/sso/launch',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({launch_url:'about:blank#home-redesign-qa'})}));
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Mở Workflows',exact:true}).click();
  const popup=await popupPromise; await popup.waitForURL('about:blank#home-redesign-qa');await popup.close();
  await page.evaluate(()=>{window.qaOriginalOpen=window.open;window.open=()=>{throw new Error('QA popup restriction');};});
  await page.getByRole('button',{name:'Mở Workflows',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Không thể mở Workflows'}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Mở Workflows',exact:true}).isEnabled(),'Popup exceptions must release loading state');
  await page.evaluate(()=>{window.open=window.qaOriginalOpen;delete window.qaOriginalOpen;});
  await page.evaluate(async()=>{
   for(const title of ['Hướng dẫn sử dụng','Liên hệ hỗ trợ','Biểu mẫu nội bộ','Một liên kết có tên rất dài để kiểm tra bố cục không tràn ra ngoài màn hình']){
    const r=await fetch('/api/bookmarks',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('dtl_platform_token'),'Content-Type':'application/json'},body:JSON.stringify({title,url:'https://example.com',category:'Cá nhân',client_request_id:crypto.randomUUID()})});
    if(!r.ok)throw new Error(await r.text());
   }
  });
  const themes=Array.isArray(catalog.themes)?catalog.themes.map(t=>t.id):Object.keys(catalog.themes);
  for(const theme of themes){
   await page.evaluate(theme=>localStorage.setItem('dtl_theme',theme),theme);await page.reload();await page.locator('.workspace-home').waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}: horizontal overflow`);
  }
  for(const [width,height] of [[1672,1050],[1280,900],[1024,900],[390,844],[360,800]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>window.scrollTo(0,0));
   const alignment=await page.locator('.nav-brand').evaluate(el=>{const mark=el.querySelector('.nav-brand-mark').getBoundingClientRect(),text=el.querySelector('.nav-brand-text').getBoundingClientRect();return {center:Math.abs(mark.y+mark.height/2-text.y-text.height/2),height:Math.abs(mark.height-text.height)};});
   assert.ok(alignment.center<1 && alignment.height<1, `${width}: logo and company text must align`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: horizontal overflow`);
   assert.ok(await page.locator('.workspace-shortcuts img[src*="icon-tasks"]').evaluate(el=>el.complete && el.naturalWidth===256),'Task shortcut must use the dedicated optimized icon');
   assert.ok(await page.locator('.bookmark-card').first().evaluate(el=>el.getBoundingClientRect().width<el.parentElement.getBoundingClientRect().width*.8),'Bookmarks should fit their text rather than fill the row');
   await page.screenshot({path:path.resolve(__dirname,`../../../.audit-backups/home-redesign-${width}.png`),fullPage:true});
   await nav.getByRole('link',{name:'DT My Note',exact:true}).click();await page.locator('.notes-page').waitFor();
   await nav.getByRole('link',{name:'DT Platform',exact:true}).click();
  }
  assert.deepEqual(errors,[]);console.log('PASS home redesign: navigation, shortcuts, app search, bookmarks, SSO popup, all themes, responsive 360–1672px; no browser errors');
 } finally {await browser?.close();fixture.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
