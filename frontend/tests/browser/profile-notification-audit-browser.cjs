const {chromium}=require('../.browser-tools/node_modules/playwright');
const {createTestUsers}=require('../support/test-users.cjs');
const {spawnSync}=require('node:child_process');
const path=require('node:path');const assert=require('node:assert/strict');
const base=process.env.PLATFORM_BASE_URL||'http://127.0.0.1:5175';
(async()=>{const fixture=createTestUsers(1);let browser;try{
 const seed=spawnSync('docker',['compose','exec','-T','platform-backend','python','-c',`import asyncio,json,sys
from app.core.database import async_session_maker
from app.db.models import User
async def run():
    account=json.load(sys.stdin)
    async with async_session_maker() as db:
        user=await db.get(User,account['id'])
        assert user.username==account['username'] and user.username.startswith('testqa_')
        user.allowed_apps='workflows'
        await db.commit()
asyncio.run(run())`],{cwd:path.resolve(__dirname,'../../..'),input:JSON.stringify(fixture.accounts[0]),encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({timezoneId:'America/Los_Angeles',viewport:{width:1500,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await page.goto(base);await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);await page.getByLabel('Mật khẩu',{exact:true}).fill(fixture.accounts[0].password);await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();await page.locator('.workspace-home').waitFor();
 const nav=page.getByRole('navigation',{name:'Điều hướng chính'});await nav.getByRole('link',{name:'Hồ sơ',exact:true}).click();
 const profile=page.locator('.profile-page');await profile.waitFor();
 assert.equal(await profile.getByText('admin',{exact:true}).count(),0,'Legacy admin field is not proof of actual access');
 assert.equal(await profile.locator('.is-granted').count(),1);assert.equal(await profile.locator('.is-unavailable').count(),2);
 assert.match(await profile.locator('[data-app-id="workflows"]').textContent(),/Đã cấp quyền/);
 assert.match(await profile.locator('[data-app-id="itam"]').textContent(),/Chưa cấp quyền/);
 await profile.getByText('Số điện thoại liên hệ',{exact:true}).click();assert.ok(await profile.getByLabel('Số điện thoại liên hệ',{exact:true}).evaluate(el=>el===document.activeElement));
 await profile.getByLabel('Số điện thoại liên hệ',{exact:true}).fill('0901234567');
 await page.route('**/api/auth/profile',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.continue();});
 const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/profile'&&r.request().method()==='PUT');
 await profile.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();assert.ok(await profile.getByLabel('Họ và tên',{exact:true}).isDisabled());assert.equal((await saved).status(),200);await profile.getByRole('button',{name:'Lưu thay đổi',exact:true}).waitFor();
 for(const width of [1024,600,390,360]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Profile overflow at ${width}`);assert.ok(await profile.locator('.profile-contacts').evaluate(el=>[...el.querySelectorAll('span')].every(node=>node.scrollWidth<=node.clientWidth+1)),`Contact text clipped at ${width}`);}
 await page.screenshot({path:path.resolve(__dirname,'../../../.audit-backups/profile-mobile-audit.png'),fullPage:true});
 await page.setViewportSize({width:1500,height:1100});
 const notice=(id,created_at)=>({id,created_at,occurred_at:created_at,source:'platform',kind:'task.reminder',title:'Thông báo công việc '+id,body:'Nội dung QA',resource_type:'task',resource_id:id,state:'active',due_at:null,read_at:null,dismissed_at:null,snoozed_until:null});
 const items=[notice('new','2026-10-21T17:30:00Z'),notice('old','2026-10-21T16:30:00Z')];
 await page.route('**/api/notifications?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items,has_more:false,next_cursor:null,server_now:'2026-10-22T04:00:00Z'})}));
 await page.getByRole('button',{name:'Thông báo',exact:true}).click();await page.getByRole('button',{name:'Xem tất cả thông báo',exact:true}).click();await page.locator('.notification-day-heading').first().waitFor();
 assert.equal(await page.locator('.notification-day-heading').count(),2,'Vietnam midnight splits days even on a US device');
 const times=await page.locator('.notifications-feed time').allTextContents();assert.match(times[0],/00:30/);assert.match(times[1],/23:30/);
 assert.deepEqual(errors,[]);console.log('PASS profile permissions, form labels/save lock, responsive 360–1500px, notification times and date grouping independent of device timezone');
}finally{await browser?.close();fixture.cleanup();}})().catch(e=>{console.error(e);process.exitCode=1;});
