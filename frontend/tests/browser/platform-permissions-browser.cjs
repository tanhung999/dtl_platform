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
    const save = page.getByRole('button', { name: 'Lưu quyền Platform', exact: true });
    await save.waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.equal(await page.getByRole('checkbox').count(), 3);
    assert.equal(await page.getByRole('checkbox', { name: 'Quản lý cơ cấu tổ chức', exact: true }).count(), 0);
    assert.equal(await page.getByRole('checkbox', { name: 'Quản lý ứng dụng', exact: true }).count(), 0);
    assert.equal(await page.locator('.admin-sidebar').getByRole('link').count(), 4);
    const menu = await page.locator('.admin-sidebar').boundingBox();
    const content = await page.locator('.admin-content').boundingBox();
    assert.ok(menu.width > 900 && Math.abs(menu.x - content.x) < 4, 'navigation should use the top, not an empty left sidebar');
    assert.equal(await page.locator('.admin-sidebar').getByRole('link', { name: 'Tài khoản', exact: true }).count(), 1);
    const share = page.getByRole('checkbox', { name: /Chia sẻ lịch cá nhân/ });
    await share.check();
    await save.click();
    await page.getByText('Đã lưu quyền Platform.', { exact: true }).waitFor();
    assert.equal(writes, 1);
    assert.equal(await save.isDisabled(), true);
    await share.uncheck();
    await save.click();
    assert.equal(writes, 1);
    await page.getByRole('button', { name: 'Xác nhận và lưu', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.platform-policy-footer button:last-child')?.disabled);
    assert.equal(writes, 2);
    const delegate = page.getByRole('checkbox', { name: /Giao công việc/ });
    await delegate.check();
    await page.getByRole('radio', { name: /Chọn phòng ban/ }).check();
    await page.locator('.assignment-department-options').getByRole('checkbox', { name: 'Nhân sự', exact: true }).check();
    await page.locator('.assignment-department-options').getByRole('checkbox', { name: 'Kế toán', exact: true }).check();
    await save.click();
    await page.waitForFunction(() => document.querySelector('.platform-policy-footer button:last-child')?.disabled);
    assert.deepEqual(policy.assignment_scope.department_ids.sort(), ['finance', 'hr']);
    if (process.env.PLATFORM_SCREENSHOT) await page.screenshot({ path: process.env.PLATFORM_SCREENSHOT.replace('.png', '-scope.png'), fullPage: true });
    await delegate.uncheck();
    await save.click();
    await page.waitForFunction(() => document.querySelector('.platform-policy-footer button:last-child')?.disabled);
    await page.getByRole('checkbox', { name: /Quản trị Platform/ }).check();
    policy = { ...policy, access_version: policy.access_version + 1 };
    await save.click();
    await page.getByRole('alert').getByText(/Quyền vừa thay đổi/).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: /Quản trị Platform/ }).isChecked(), true);
    await page.getByRole('button', { name: 'Tải lại quyền', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.platform-permission-option input')].every(input => !input.checked));
    for (const theme of Object.keys(require('../../src/theme/catalog.json').themes)) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
      for (const width of [1480, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${theme} ${width}: horizontal overflow`);
      }
    }
    limited = true;
    // An already-open page must lose its administration controls after invalidation.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('workspace:changed', { detail: ['calendar-sharing'] })));
    await page.getByRole('alert').getByText('Bạn không có quyền truy cập trang quản trị.', { exact: true }).waitFor();
    assert.equal(await page.locator('.admin-sidebar').count(), 0);
    assert.equal(await page.getByRole('checkbox').count(), 0);
    limited = false;
    await page.goto(base + '/admin/users');
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await page.getByLabel('Tên đăng nhập', { exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Quản trị Platform', exact: true }).count(), 0);
    assert.equal(await page.getByText('Quản lý trực tiếp', { exact: true }).count(), 0);
    await page.locator('.admin-sidebar').getByRole('link', { name: 'Tổ chức', exact: true }).click();
    await page.locator('.organization-admin').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cấp bậc', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Vị trí / chức danh', exact: true }).click();
    assert.equal(await page.getByText('Chọn cấp bậc', { exact: true }).count(), 0);
    for (const width of [1480, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `organization ${width}: overflow`);
    }
    if (process.env.PLATFORM_SCREENSHOT) {
      await page.setViewportSize({ width: 1480, height: 1000 });
      await page.locator('.admin-sidebar').getByRole('link', { name: 'Phân quyền', exact: true }).click();
      await page.getByRole('button', { name: /Nhân viên kiểm thử/ }).click();
      await page.getByRole('button', { name: 'Lưu quyền Platform', exact: true }).waitFor();
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.body.dataset.theme = 'light'; });
      await page.screenshot({ path: process.env.PLATFORM_SCREENSHOT, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: unified admin controls all four sections; no separate organization/application switches; saved state, save, revoke confirmation, conflicts and nine responsive themes. No real data used.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
