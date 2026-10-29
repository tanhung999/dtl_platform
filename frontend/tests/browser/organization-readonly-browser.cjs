const {chromium}=require('../.browser-tools/node_modules/playwright');
const {createTestUsers}=require('../support/test-users.cjs');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const base=process.env.PLATFORM_BASE_URL||'http://localhost:5173';

(async()=>{
 const fixture=createTestUsers(3);let browser;
 try{
  const seed=`import asyncio,sys
from app.core.database import async_session_maker
from app.db.access import UserRole
async def main():
 async with async_session_maker() as db:
  db.add(UserRole(user_id=sys.argv[1],role_id='access_admin'))
  await db.commit()
asyncio.run(main())`;
  const prepared=spawnSync('docker',['compose','exec','-T','platform-backend','python','-c',seed,fixture.accounts[0].id],{cwd:path.resolve(__dirname,'../../..'),encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[];
  const login=async account=>{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});
   page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);
   page.on('pageerror',error=>errors.push(error.message));
   await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());
   await page.goto(base+'/login');await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username);
   await page.getByLabel('Mật khẩu',{exact:true}).fill(account.password);
   await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();await page.waitForURL('**/homepage');return page;
  };
  const owner=await login(fixture.accounts[0]);
  let catalog={departments:[],positions:[],job_levels:[],work_locations:[]};
  let writes=0,release,fail=false,readFail=false;
  const delayed=()=>new Promise(resolve=>{release=resolve;});
  let held=delayed();
  await owner.route('**/api/admin/organization**',async route=>{
   const method=route.request().method();
   if(method==='GET')return route.fulfill({status:readFail?503:200,json:readFail?{detail:'Không tải được danh sách.'}:catalog});
   writes++;await held;
   if(fail)return route.fulfill({status:409,json:{detail:'Mã đã tồn tại. Hãy chọn mã khác.'}});
   const item=route.request().postDataJSON();
   if(method==='POST')catalog.departments.push({...item,id:'qa-department'});
   if(method==='PUT')catalog.departments[0]={...item,id:'qa-department'};
   return route.fulfill({status:200,json:{...item,id:'qa-department'}});
  });
  await owner.goto(base+'/admin/organization');
  const form=owner.locator('.organization-form');
  await form.getByPlaceholder('Mã',{exact:true}).fill('QA-ORG');
  await form.getByPlaceholder('Tên',{exact:true}).fill('Bộ phận thử nghiệm');
  const creating=owner.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/api/admin/organization/departments');
  await form.getByRole('button',{name:'Thêm',exact:true}).click();
  await creating;
  await form.getByRole('button',{name:'Đang lưu…',exact:true}).waitFor();
  assert.equal(await form.getByPlaceholder('Mã',{exact:true}).isDisabled(),true);
  assert.equal(await owner.locator('.organization-tabs button:enabled').count(),0);
  await form.dispatchEvent('submit');
  await owner.waitForTimeout(100);assert.equal(writes,1,'A duplicate submit must not send another write');
  release();await owner.getByRole('status').filter({hasText:'Đã thêm thành công.'}).waitFor();
  await form.getByRole('button',{name:'Thêm',exact:true}).waitFor({state:'visible'});
  held=delayed();fail=true;
  await owner.locator('.organization-list').getByRole('button',{name:'Sửa',exact:true}).click();
  await form.getByPlaceholder('Tên',{exact:true}).fill('Tên được giữ khi lưu lỗi');
  await form.getByRole('button',{name:'Lưu',exact:true}).click();
  await form.getByRole('button',{name:'Đang lưu…',exact:true}).waitFor();
  release();await owner.getByRole('alert').filter({hasText:'Mã đã tồn tại.'}).waitFor();
  assert.equal(await form.getByPlaceholder('Tên',{exact:true}).inputValue(),'Tên được giữ khi lưu lỗi');
  assert.equal(await form.getByRole('button',{name:'Lưu',exact:true}).isEnabled(),true);
  held=delayed();fail=false;readFail=true;
  await form.getByRole('button',{name:'Lưu',exact:true}).click();
  await form.getByRole('button',{name:'Đang lưu…',exact:true}).waitFor();
  release();await owner.getByRole('alert').filter({hasText:'Dữ liệu đã được lưu, nhưng chưa tải lại được danh sách.'}).waitFor();
  assert.equal(await form.getByPlaceholder('Tên',{exact:true}).inputValue(),'');
  assert.equal(writes,3);
  await owner.unroute('**/api/admin/organization**');
  const token=await owner.evaluate(()=>localStorage.getItem('dtl_platform_token'));
  const response=await owner.request.post(base+'/api/tasks',{headers:{Authorization:`Bearer ${token}`},data:{title:'QA role notice task',assignee_id:fixture.accounts[1].id,follower_ids:[fixture.accounts[2].id]}});
  assert.equal(response.status(),201,await response.text());
  await owner.goto(base+'/tasks');
  await owner.locator('.task-item').filter({hasText:'QA role notice task'}).getByRole('button',{name:'Sửa QA role notice task',exact:true}).click();
  assert.equal(await owner.locator('.task-readonly-notice').count(),0);
  for(const [account,notice] of [[fixture.accounts[1],'Bạn là người được giao công việc'],[fixture.accounts[2],'Bạn là người theo dõi · Chỉ xem']]){
   const page=await login(account);await page.goto(base+'/tasks');
   await page.locator('.task-item').filter({hasText:'QA role notice task'}).getByRole('button',{name:'Sửa QA role notice task',exact:true}).click();
   await page.getByRole('note').getByText(notice,{exact:true}).waitFor();
   assert.equal(await page.getByRole('dialog').getByLabel('Tên công việc',{exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Lưu công việc',exact:true}).count(),0);
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: organization duplicate-submit guard, locked controls, error/draft recovery, committed-save refresh failure, and accurate owner/assignee/follower notices.');
 }finally{await browser?.close();fixture.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
