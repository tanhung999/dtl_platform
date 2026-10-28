// Run only against the isolated identity rehearsal stack; never production.
const assert = require('node:assert/strict');
const { chromium } = require('../.browser-tools/node_modules/playwright');
const base = process.env.IDENTITY_TEST_URL || 'http://localhost:18080';
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/);
const password = process.env.IDENTITY_TEST_PASSWORD;
assert.ok(password, 'Set IDENTITY_TEST_PASSWORD for the linked rehearsal admin.');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  // Rehearsal must not call the live application's SSO logout targets or CDNs.
  const externalRequests = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === base) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/login');
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await page.waitForURL('**/homepage');
    const cookie = (await context.cookies()).find(value => value.name === 'dtl_platform_session');
    assert.ok(cookie?.httpOnly);
    assert.equal(cookie.secure, false);
    assert.equal(cookie.sameSite, 'Lax');
    assert.equal(await page.evaluate(() => localStorage.getItem('dtl_platform_token')), '');
    assert.ok(!await page.evaluate(() => document.cookie.includes('dtl_platform_session')));
    await page.reload();
    await page.getByRole('button', { name: 'DT Task', exact: true }).waitFor();
    // Existing production tabs use JSON + Origin, before the new header exists.
    assert.equal(await page.evaluate(async () => {
      const me = await (await fetch('/api/auth/me')).json();
      return (await fetch('/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: me.full_name }) })).status;
    }), 200);
    const avatarProbe = 'http://avatar.example.invalid/identity-avatar.png';
    await page.evaluate(url => new Promise(resolve => {
      const image = new Image(); image.onload = image.onerror = () => resolve(null); image.src = url;
    }), avatarProbe);
    assert.ok(externalRequests.includes(avatarProbe), 'CSP must allow supported external avatar URLs');
    await page.goto(base + '/tasks');
    const title = 'Identity browser task ' + Date.now();
    await page.getByRole('textbox', { name: 'Tên việc mới' }).fill(title);
    const write = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Thêm công việc', exact: true }).click();
    const response = await write;
    assert.equal(response.status(), 201);
    assert.equal(response.request().headers()['x-platform-request'], '1');
    const task = await response.json();
    const headers = { 'X-Platform-Request': '1', Origin: base };
    const noteResponse = await context.request.post(base + '/api/notes', {
      headers, data: { title: 'Identity browser note', content: 'Cookie-authenticated note', is_pinned: true,
        request_id: require('node:crypto').randomUUID() },
    });
    assert.equal(noteResponse.status(), 201);
    const note = await noteResponse.json();
    const noteUpdate = await context.request.patch(base + '/api/notes/' + note.id,
      { headers, data: { title: 'Identity browser note edited', expected_version: note.version } });
    assert.equal(noteUpdate.status(), 200);
    assert.equal((await context.request.delete(base + '/api/notes/' + note.id,
      { headers, data: { expected_version: (await noteUpdate.json()).version } })).status(), 204);
    const eventData = { title: 'Identity browser event', starts_at: '2099-11-01T09:00:00+07:00',
      ends_at: '2099-11-01T10:00:00+07:00', is_all_day: false, color: '#2563eb' };
    const eventResponse = await context.request.post(base + '/api/calendar/events', { headers, data: eventData });
    assert.equal(eventResponse.status(), 201);
    const event = await eventResponse.json();
    const eventUpdate = await context.request.put(base + '/api/calendar/events/' + event.id,
      { headers, data: { ...eventData, title: 'Identity browser event edited', expected_updated_at: event.updated_at } });
    assert.equal(eventUpdate.status(), 200);
    assert.equal((await context.request.delete(base + '/api/calendar/events/' + event.id + '?expected_updated_at=' +
      encodeURIComponent((await eventUpdate.json()).updated_at), { headers })).status(), 204);
    // Remove only the task created by this browser fixture.
    assert.equal((await context.request.delete(base + '/api/tasks/' + task.id + '?expected_version=' + task.version,
      { headers: { 'X-Platform-Request': '1', Origin: base } })).status(), 204);
    const privateTitle = 'Admin account cache ' + Date.now();
    const privateResponse = await context.request.post(base + '/api/notes', {
      headers, data: { title: privateTitle, content: 'Only the owner should see this cached preview', is_pinned: true,
        request_id: require('node:crypto').randomUUID() },
    });
    assert.equal(privateResponse.status(), 201);
    const privateNote = await privateResponse.json();
    const employeeName = 'identity.cache.' + Date.now();
    const employeePassword = require('node:crypto').randomUUID();
    const employeeResponse = await context.request.post(base + '/api/admin/users', {
      headers, data: { username: employeeName, email: employeeName + '@example.com',
        full_name: 'Identity Cache Employee', password: employeePassword },
    });
    assert.equal(employeeResponse.status(), 201);
    // Populate the module cache, then change accounts through SPA navigation.
    await page.goto(base + '/homepage');
    await page.locator(`[data-note-id="${privateNote.id}"]`).waitFor();
    await page.locator('.enterprise-app-card').first().waitFor();
    const otherTab = await context.newPage();
    otherTab.on('pageerror', error => errors.push(error.message));
    await otherTab.goto(base + '/homepage');
    await otherTab.locator(`[data-note-id="${privateNote.id}"]`).waitFor();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await page.waitForFunction(() => location.pathname === '/login');
    await page.locator('#username').waitFor();
    await otherTab.waitForFunction(() => location.pathname === '/login');
    await otherTab.locator('#username').waitFor();
    const logoutHosts = externalRequests.filter(url => url.includes('/api/auth/local-logout')).map(url => new URL(url).hostname);
    for (const host of ['incomestatement.dongtayland.vn', 'workflow.dongtayland.vn', 'qlts.dongtayland.vn']) {
      assert.ok(logoutHosts.includes(host), 'CSP blocked company SSO logout: ' + host);
    }
    // A failed fetch must not leave the previous account's cached notes/apps on screen.
    await context.route('**/api/notes/collection/page**', route => route.fulfill({ status: 503,
      contentType: 'application/json', body: JSON.stringify({ detail: 'Kiểm thử lỗi tải ghi chú' }) }));
    await context.route('**/api/applications/me', route => route.fulfill({ status: 503,
      contentType: 'application/json', body: JSON.stringify({ detail: 'Kiểm thử lỗi tải ứng dụng' }) }));
    await page.locator('#username').fill(employeeName);
    await page.locator('#password').fill(employeePassword);
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await page.waitForURL('**/homepage');
    await otherTab.waitForFunction(() => location.pathname === '/homepage');
    await page.locator('.pinned-notes-widget .alert-error').filter({ hasText: 'Kiểm thử lỗi tải ghi chú' }).waitFor();
    await page.getByText('Kiểm thử lỗi tải ứng dụng', { exact: true }).waitFor();
    assert.equal(await page.locator(`[data-note-id="${privateNote.id}"]`).count(), 0);
    assert.equal(await page.locator('.enterprise-app-card').count(), 0);
    await otherTab.locator('.pinned-notes-widget .alert-error').filter({ hasText: 'Kiểm thử lỗi tải ghi chú' }).waitFor();
    assert.equal(await otherTab.locator(`[data-note-id="${privateNote.id}"]`).count(), 0);
    assert.equal(await otherTab.locator('.enterprise-app-card').count(), 0);
    assert.equal((await context.request.get(base + '/api/notes/' + privateNote.id)).status(), 404);
    // Clean up only our owner's note, with a fresh owner login.
    assert.equal((await context.request.post(base + '/api/auth/login', {
      headers, data: { username: 'admin', password },
    })).status(), 200);
    assert.equal((await context.request.delete(base + '/api/notes/' + privateNote.id,
      { headers, data: { expected_version: privateNote.version } })).status(), 204);
    assert.equal((await context.request.post(base + '/api/auth/oidc/logout', { headers })).status(), 200);
    await page.goto(base + '/tasks');
    await page.waitForURL('**/login');
    await otherTab.close();
    assert.deepEqual(errors, []);
    console.log('PASS browser cookie login, refresh, old frontend JSON, external avatars, task/note/event writes, cross-app logout, account cache isolation and protected routes');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
