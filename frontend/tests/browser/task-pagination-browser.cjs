const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
(async () => {
  const fixture = createTestUsers(1); let browser;
  try {
    const base = 'http://127.0.0.1:8000/api';
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.accounts[0]) });
    assert.equal(login.status, 200); const { access_token } = await login.json();
    const api = async (method, path, data) => {
      const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
      assert.ok(response.ok, path + ' ' + response.status); return response.status === 204 ? null : response.json();
    };
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    for (let i = 0; i < 31; i++) {
      const task = await api('POST', '/tasks', { title: i === 30 ? 'Đề xuất họp phòng KD' : 'Pagination task ' + i, description: 'Nội dung công việc ' + i, due_date: day });
      if (i === 30) await api('PATCH', '/tasks/' + task.id, { expected_version: task.version, is_completed: true });
    }
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(20000);
    const errors = [], reads = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/tasks/collection') reads.push(new URL(request.url())); });
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    const widget = page.locator('.tasks-widget'), rows = widget.locator('.task-item');
    await rows.nth(7).waitFor(); assert.equal(await rows.count(), 8);
    await widget.getByText('1–8 / 31', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.calendar-widget [data-deadline-id]').length === 31);
    assert.equal(reads[0].searchParams.get('limit'), '8');
    await widget.getByRole('button', { name: 'Trang sau', exact: true }).click();
    await widget.getByText('9–16 / 31', { exact: true }).waitFor();
    const widgetIds = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.taskId));
    await widget.getByRole('button', { name: 'Xem tất cả', exact: true }).click();
    const full = page.getByRole('region', { name: 'Tất cả công việc', exact: true });
    await full.locator('.task-item').nth(24).waitFor(); assert.equal(await full.locator('.task-item').count(), 25);
    await full.getByRole('button', { name: 'Trang sau', exact: true }).click();
    await full.getByText('26–31 / 31', { exact: true }).waitFor(); assert.equal(await full.locator('.task-item').count(), 6);
    await full.getByRole('button', { name: 'Đã xong (1)', exact: true }).click();
    await full.getByRole('button', { name: '✓ Đề xuất họp phòng KD', exact: true }).waitFor();
    await full.getByRole('searchbox', { name: 'Tìm công việc' }).fill('de xuat');
    await page.waitForResponse(response => response.ok() && new URL(response.url()).searchParams.get('q') === 'de xuat');
    assert.equal(await full.locator('.task-item').count(), 1);
    await full.getByRole('button', { name: 'Chưa làm (30)', exact: true }).click();
    await full.getByText('Không có công việc phù hợp.', { exact: true }).waitFor();
    await full.getByRole('searchbox', { name: 'Tìm công việc' }).fill('pagination task');
    await full.locator('.task-item').nth(24).waitFor();
    await full.getByRole('button', { name: 'Về Workspace', exact: true }).click();
    await widget.getByText('9–16 / 31', { exact: true }).waitFor();
    assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(node => node.dataset.taskId)), widgetIds);
    assert.equal(await page.locator('.calendar-widget [data-deadline-id]').count(), 31);
    await widget.getByRole('button', { name: 'Xem tất cả', exact: true }).click();
    await full.getByRole('searchbox', { name: 'Tìm công việc' }).waitFor();
    assert.equal(await full.getByRole('searchbox', { name: 'Tìm công việc' }).inputValue(), 'pagination task');
    await full.locator('.task-item').nth(24).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log('PASS: widget 8/full 25, SQL search, global counts, independent view state, full calendar, mobile');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
