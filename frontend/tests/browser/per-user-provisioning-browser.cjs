// Uses only intercepted API fixtures; never connects to a database or company server.
const { chromium } = require(process.env.PLATFORM_PLAYWRIGHT_PATH || '../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5183';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1480, height: 1000 }, reducedMotion: 'reduce' });
    const user = { id: 'qa-admin', username: 'qa.admin', full_name: 'Quản trị kiểm thử', email: 'admin@example.test', role: 'Người dùng' };
    const account = { id: 'qa-member', username: 'qa.member', full_name: 'Nhân viên kiểm thử', is_active: true, can_share: false, access_version: 0 };
    const departments = [{ id: 'hr', name: 'Nhân sự', is_active: true }, { id: 'finance', name: 'Kế toán', is_active: true }];
    let policy = { permissions: [], access_version: 0, can_assign_tasks: false,
      assignment_scope: { mode: 'current_department', department_ids: [] }, home_department_id: 'hr', departments };
    const applications = ['workflows', 'itam', 'bookingreports'].map(key => ({ key, display_name: key,
      description: '', icon_key: 'platform', enabled: true, role_key: 'basic', role_display_name: 'Basic',
      permission_keys: ['view'], project_names: [], roles: [{key:'basic',display_name:'Basic',description:'',permission_keys:['view']}, {key:'extra',display_name:'Extra',description:'',permission_keys:['write']}], permissions: [{code:'view',display_name:'View',group_name:'Actions'}, {code:'write',display_name:'Write',group_name:'Actions'}, {code:'delete',display_name:'Delete',group_name:'Actions'}] }));
    const states = Object.fromEntries(applications.map(app=>[app.key,{configured:true,state:'unlinked',enabled:false,version:0,pending_enabled:null,managed_by_platform:false,can_enable:true}]));
    let interrupt = true;
    const attempts = [];
    let writes = 0;
    let limited = false;
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(user => {
      localStorage.setItem('dtl_platform_token', 'isolated-test-token');
      localStorage.setItem('dtl_platform_user', JSON.stringify(user));
    }, user);
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/auth/me') return respond(user);
      if (path === '/api/access/me') return respond({ can_manage: !limited, can_share: false, can_assign_tasks: false, can_access_admin: !limited });
      if (path === '/api/admin/users') return respond({ items: [], total: 0, page: 1, has_more: false });
      if (path === '/api/admin/organization') return respond({ departments, positions: [], work_locations: [] });
      if (path === '/api/workspace/stream') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"kind":"ready","versions":{}}\n\n' });
      if (path === '/api/notifications/summary') return respond({ unread_count: 0, preview: [], server_now: new Date().toISOString() });
      if (path === '/api/access/accounts') return respond({ items: [account], total: 1, page: 1, has_more: false });
      if (path === '/api/access/users/qa-member') return respond({ ...account, can_share: policy.permissions.includes('calendar.share.manage'), access_version: policy.access_version });
      if (path === '/api/admin/applications/users/qa-member/access') return respond(applications);
      if (path.endsWith('/provisioning/unlink')) {
        const key = path.split('/')[4], payload = route.request().postDataJSON();
        assert.deepEqual(Object.keys(payload).sort(),['expected_revision','expected_version','external_user_id','operation_id']);
        states[key] = {...states[key],state:'unlinked',account:null,enabled:false,can_enable:false,collision:true,managed_by_platform:false};
        applications.find(app=>app.key===key).enabled=false;
        return respond({unlinked:true,access_revoked:true});
      }
      if (path.endsWith('/provisioning')) {
        const key=path.split('/')[4], current=states[key];
        if (route.request().method()==='PUT') {
          const payload=route.request().postDataJSON();
          assert.equal(payload.expected_version,current.version);
          if (interrupt) { interrupt=false;current.pending_enabled=payload.enabled;current.version++;return respond({detail:'Temporary connection interruption'},503); }
          current.enabled=payload.enabled;current.pending_enabled=null;current.version++;
        }
        return respond(current);
      }
      if (path === '/api/admin/applications/workflows/users/qa-member' && route.request().method() === 'PUT') {
        const payload = route.request().postDataJSON();
        assert.equal('role_key' in payload, false, 'Editing an individual permission must not replace imported roles');
        const application = applications.find(item=>item.key==='workflows');
        application.permission_keys = payload.permission_keys;
        return respond(application);
      }
      if (path.includes('/policy-link')) {
        const key = path.split('/')[4];
        if (path.endsWith('/candidates')) return respond({items: [{account: {id:'destination-'+key,username:'qa.member',full_name:'Existing employee',email:'member@example.test',identity_subject:null,is_active:true},role_keys:['basic','extra'],permission_keys:['write'],project_names:['Project A'],revision:'a'.repeat(64)}, {account: {id:'other',username:'other',full_name:'Already linked elsewhere',identity_subject:'someone-else',is_active:true},role_keys:[],permission_keys:[],project_names:[],revision:'b'.repeat(64)}],has_more:false,platform_subject:'central-subject',grant_updated_at:'2026-11-03T00:00:00Z'});
        const payload = route.request().postDataJSON(); attempts.push(payload);
        if (attempts.filter(item=>item.external_user_id===payload.external_user_id).length === 1) return respond({detail:'Temporary connection interruption'},503);
        Object.assign(applications.find(item=>item.key===key), {policy_import_id: payload.operation_id,
          role_keys: ['basic','extra'], role_display_name:'Basic, Extra', permission_keys:['write'],project_names:['Project A']});
        return respond({linked:true,changed:true});
      }
      if (path.endsWith('/platform-permissions')) {
        if (route.request().method() === 'PUT') {
          const payload = route.request().postDataJSON();
          if (payload.expected_version !== policy.access_version) return respond({ detail: 'Quyền vừa thay đổi. Hãy tải lại và kiểm tra trước khi lưu.' }, 409);
          writes++;
          policy = { ...policy, permissions: payload.permissions, assignment_scope: payload.assignment_scope, access_version: policy.access_version + 1 };
        }
        return respond(policy);
      }
      if (path.endsWith('/access') || path === '/api/applications') return respond([]);
      if (path === '/api/access/history') return respond({ items: [], next_cursor: null });
      return respond({});
    });
    async function open() {
      await page.goto(base+'/admin/permissions');
      await page.getByRole('button',{name:/Nhân viên kiểm thử/}).click();
      await page.getByRole('tab',{name:'Ứng dụng',exact:true}).click();
    }
    await open();
    const workflow=page.locator('.access-application-block').filter({has:page.getByRole('heading',{name:'workflows',exact:true})});
    const control=workflow.getByRole('switch');
    assert.equal(await control.isChecked(),false);
    await control.click();
    await workflow.getByRole('alert').waitFor();
    await workflow.getByRole('button',{name:'Thử lại',exact:true}).waitFor();
    assert.equal(states.itam.enabled,false);assert.equal(states.bookingreports.enabled,false);
    await open();
    await workflow.getByRole('button',{name:'Thử lại',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.application-account-warning button'));
    assert.equal(await control.isChecked(),true);
    await control.click();
    await page.waitForFunction(()=>!document.querySelector('.application-create-option input')?.checked);
    assert.equal(states.workflows.enabled,false);
    states.workflows={...states.workflows,state:'linked',account:{id:'existing-123',username:'qa.member',email:'member@example.test',is_active:true},
      revision:'b'.repeat(64),can_enable:false,managed_by_platform:true};
    await workflow.getByRole('button',{name:'Tải lại trạng thái tài khoản',exact:true}).click();
    await workflow.getByText('Đã liên kết · @qa.member',{exact:true}).waitFor();
    assert.equal(await control.count(),0);
    await workflow.getByRole('button',{name:'Hủy liên kết',exact:true}).click();
    await workflow.getByRole('button',{name:'Xác nhận hủy liên kết',exact:true}).click();
    await workflow.getByRole('button',{name:'Cấp quyền',exact:true}).waitFor();
    assert.equal(await control.isChecked(),false);assert.equal(await control.isDisabled(),true);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: default off, app isolation, durable pending consent after reload, retry, turn off, linked state, unlink resets access, and mobile layout. All APIs intercepted.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
