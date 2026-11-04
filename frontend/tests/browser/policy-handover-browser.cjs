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
      if (path.endsWith('/provisioning')) {
        const application = applications.find(item=>item.key===path.split('/')[4]);
        return respond({configured:true,state:application.policy_import_id?'linked':'unlinked',enabled:false,version:0,pending_enabled:null,
          managed_by_platform:!!application.policy_import_id,can_enable:!application.policy_import_id,
          account:application.policy_import_id?{id:'destination-'+application.key,username:'qa.member',email:'member@example.test',is_active:true}:null,
          revision:'a'.repeat(64)});
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
    await page.goto(base + '/admin/permissions');
    await page.getByRole('button', { name: /Nhân viên kiểm thử/ }).click();
    await page.getByRole('tab', { name: 'Ứng dụng', exact: true }).click();
    for (const application of applications) {
      const block = page.locator('.access-application-block').filter({has: page.getByRole('heading',{name:application.display_name,exact:true})});
      await block.getByRole('button',{name:'Liên kết tài khoản có sẵn',exact:true}).click();
      const radios = block.getByRole('radio'); await radios.first().waitFor();
      assert.equal(await radios.nth(1).isDisabled(),true);
      await radios.first().check();
      await block.getByRole('button',{name:'Xác nhận liên kết và nhập quyền',exact:true}).click();
      await block.getByRole('alert').waitFor();
      assert.equal(await block.getByRole('textbox').isDisabled(),true);
      await block.getByRole('button',{name:'Thử lại cùng thao tác',exact:true}).click();
      await block.getByText('Đã liên kết · @qa.member',{exact:true}).waitFor();
    }
    assert.equal(attempts.length,6);
    for (let i=0;i<attempts.length;i+=2) assert.deepEqual(attempts[i],attempts[i+1]);
    const workflow = page.locator('.access-application-block').filter({has:page.getByRole('heading',{name:'workflows',exact:true})});
    await workflow.getByRole('button',{name:/Cấu hình/}).click();
    assert.equal(await workflow.getByRole('combobox').inputValue(),'');
    await workflow.getByRole('checkbox',{name:'Delete',exact:true}).click();
    await page.waitForFunction(() => {
      const block = [...document.querySelectorAll('.access-application-block')].find(item=>item.querySelector('h4')?.textContent==='workflows');
      return [...(block?.querySelectorAll('label') || [])].find(label=>label.textContent==='Delete')?.querySelector('input')?.checked;
    });
    await workflow.getByText('Đang giữ:',{exact:false}).waitFor();
    assert.deepEqual(applications.find(item=>item.key==='workflows').role_keys,['basic','extra']);
    assert.deepEqual(errors,[]);
    console.log('PASS: all three account-link UIs preserve operation IDs on interruption, block selecting another account, and show central ownership after confirmation. No live API or data used.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
