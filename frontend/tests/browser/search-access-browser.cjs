const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://localhost:5173';

(async () => {
  const fixture = createTestUsers(3); let browser;
  try {
    const seed = `import asyncio,sys
from sqlalchemy import select
from app.core.database import async_session_maker
from app.db.access import UserRole
from app.db.applications import UserApplicationAccess,ApplicationRole
async def main():
    async with async_session_maker() as db:
        db.add_all([UserRole(user_id=sys.argv[1],role_id='access_admin'),UserRole(user_id=sys.argv[1],role_id='calendar_sharer'),UserRole(user_id=sys.argv[2],role_id='access_admin')])
        role=await db.scalar(select(ApplicationRole).where(ApplicationRole.application_key=='workflows').order_by(ApplicationRole.sort_order.desc()))
        db.add(UserApplicationAccess(user_id=sys.argv[3],application_key='workflows',enabled=False,role_id=role.id if role else None,project_names=['QA existing project']))
        await db.commit()
asyncio.run(main())`;
    const seeded = spawnSync('docker', ['compose','exec','-T','platform-backend','python','-c',seed,...fixture.accounts.map(item=>item.id)], {cwd:path.resolve(__dirname,'../../..'),encoding:'utf8'});
    assert.equal(seeded.status,0,seeded.stderr);
    browser = await chromium.launch({channel:'msedge',headless:true});
    const login = async account => {
      const page=await browser.newPage({viewport:{width:1440,height:1000}});
      page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
      await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());
      await page.goto(base+'/login');
      await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username);
      await page.getByLabel('Mật khẩu',{exact:true}).fill(account.password);
      await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();
      await page.waitForURL('**/homepage'); return page;
    };
    const api=async(page,method,url,data)=>{
      const token=await page.evaluate(()=>localStorage.getItem('dtl_platform_token'));
      const response=await page.request.fetch(base+'/api/'+url,{method,data,headers:{Authorization:`Bearer ${token}`}});
      assert.ok(response.ok(),await response.text());return response.status()===204?null:response.json();
    };
    const owner=await login(fixture.accounts[0]), viewer=await login(fixture.accounts[1]);
    const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
    const schedule={starts_at:day+'T09:00:00+07:00',ends_at:day+'T10:00:00+07:00',is_all_day:false};
    await api(owner,'POST','tasks',{title:'QA Shared Search task',due_date:day,assignee_id:fixture.accounts[2].id});
    await api(owner,'POST','notes',{title:'QA Shared Search note',content:'Shared note body',calendar_schedule:schedule});
    await api(owner,'POST','calendar/events',{title:'QA Shared Search event',...schedule});
    await api(owner,'POST','calendar/events',{title:'QA Shared Search private',is_private:true,...schedule});
    await api(owner,'POST','tasks',{title:'QA Direct Search task',assignee_id:fixture.accounts[1].id,is_private:true});
    await api(owner,'POST','calendar/events',{title:'QA Direct Search event',follower_ids:[fixture.accounts[1].id],is_private:true,...schedule});
    const grant=await api(owner,'PUT','calendar-sharing/mine/'+fixture.accounts[1].id,{expected_version:0,share_tasks:true,share_events:true,share_notes:true});
    const search=viewer.getByRole('searchbox',{name:'Tìm kiếm toàn hệ thống'});
    await search.fill('QA Shared Search');
    await viewer.waitForFunction(()=>document.querySelectorAll('.search-result').length===3);
    for(const [title,kind] of [['QA Shared Search task','Công việc'],['QA Shared Search event','Sự kiện'],['QA Shared Search note','Ghi chú']]){
      await viewer.locator('.search-result').filter({hasText:title}).click();
      const dialog=viewer.getByRole('dialog',{name:kind+' · Chỉ xem',exact:true});
      await dialog.getByRole('heading',{name:title,exact:true}).waitFor();
      assert.equal(await dialog.getByRole('button',{name:/Lưu|Dời lịch|Áp dụng/}).count(),0);
      await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
    }
    await search.fill('QA Direct Search');
    await viewer.waitForFunction(()=>document.querySelectorAll('.search-result').length===2);
    for(const [title,kind,close] of [['QA Direct Search task','Chi tiết công việc','Đóng công việc'],['QA Direct Search event','Chi tiết sự kiện','Đóng']]){
      await viewer.locator('.search-result').filter({hasText:title}).click();
      const dialog=viewer.getByRole('dialog',{name:kind,exact:true}); await dialog.waitFor();
      await dialog.getByRole('button',{name:close,exact:true}).click();
    }
    await search.fill('DT');
    await viewer.locator('.search-filters').getByRole('button',{name:'Ứng dụng',exact:true}).click();
    const catalog=await api(viewer,'GET','search?q=DT&kind=apps&limit=20');
    await viewer.waitForFunction(count=>document.querySelectorAll('.enterprise-app-card').length===count,catalog.groups.apps.total);
    const popupWait=viewer.waitForEvent('popup');
    await viewer.getByRole('button',{name:'Mở DT Workflow',exact:true}).click();
    const denied=await popupWait; await denied.waitForURL('**/access-denied?**'); await denied.close();
    await viewer.goto(base+'/admin/permissions');
    await viewer.getByLabel('Tìm tài khoản',{exact:true}).fill(fixture.accounts[2].username);
    await viewer.locator('.access-account-list').getByRole('button').filter({hasText:'@'+fixture.accounts[2].username}).click();
    const block=viewer.locator('.access-application-block').filter({has:viewer.getByRole('heading',{name:'DT Workflow',exact:true})});
    await block.getByRole('button',{name:'Cấp quyền',exact:true}).waitFor();
    const before=(await api(viewer,'GET','admin/applications/users/'+fixture.accounts[2].id+'/access')).find(item=>item.key==='workflows');
    const changes=[]; viewer.on('request',request=>{if(request.method()==='PUT'&&new URL(request.url()).pathname==='/api/admin/applications/workflows/users/'+fixture.accounts[2].id) changes.push(request.postDataJSON());});
    await block.getByRole('button',{name:'Cấp quyền',exact:true}).click();
    await block.getByRole('button',{name:'Thu hồi',exact:true}).waitFor();
    const after=(await api(viewer,'GET','admin/applications/users/'+fixture.accounts[2].id+'/access')).find(item=>item.key==='workflows');
    for(const key of ['role_key','permission_keys','project_names']) assert.deepEqual(after[key],before[key]);
    if (after.roles.length) {
      await block.getByRole('button',{name:'Cấu hình',exact:true}).click();
      await block.getByText('Role nghiệp vụ',{exact:true}).waitFor();
      await block.getByText('Phạm vi dự án',{exact:true}).waitFor();
    }
    await block.getByRole('button',{name:'Thu hồi',exact:true}).click();
    await block.getByRole('button',{name:'Cấp quyền',exact:true}).waitFor();
    assert.deepEqual(changes,[{enabled:true},{enabled:false}]);
    await viewer.goto(base+'/search?q=QA%20Shared%20Search');
    await viewer.locator('.search-result').filter({hasText:'QA Shared Search note'}).click();
    await viewer.getByRole('dialog',{name:'Ghi chú · Chỉ xem',exact:true}).getByRole('heading',{name:'QA Shared Search note'}).waitFor();
    await api(owner,'DELETE','calendar-sharing/mine/'+fixture.accounts[1].id+'?expected_version='+grant.version+'&expected_id='+grant.id);
    await viewer.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await viewer.getByRole('dialog',{name:'Ghi chú · Chỉ xem',exact:true}).waitFor({state:'hidden'});
    await viewer.getByText('Không tìm thấy kết quả phù hợp.',{exact:true}).waitFor();
    console.log('PASS: shared search/privacy/read-only/revocation, assigned and followed results, denied app discovery; original application policy controls restored.');
  } finally {await browser?.close();fixture.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
