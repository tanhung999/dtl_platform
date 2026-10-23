const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');

(async () => {
  const fixture = createTestUsers(1);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    page.setDefaultTimeout(30000);
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async (method, path, data) => {
      const response = await fetch('http://127.0.0.1:8000/api' + path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`Fixture ${path}: ${response.status}`);
      return response.status === 204 ? undefined : response.json();
    };
    const lost = async (pattern, method) => {
      let first = true, keys = [];
      await page.route(pattern, async route => {
        if (route.request().method() !== method) return route.continue();
        keys.push(route.request().postDataJSON()?.client_request_id);
        if (!first) return route.continue();
        first = false;
        const saved = await route.fetch(); assert.ok(saved.ok());
        await route.abort('failed'); // Commit succeeded; only the browser response is lost.
      });
      return keys;
    };
    const taskKeys = await lost('**/api/tasks', 'POST');
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'DT Task', exact: true }).click();
    const widget = page.locator('.tasks-widget');
    await widget.getByLabel('Tên việc mới').fill('Recovered task');
    await widget.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
    await widget.getByRole('button', { name: 'Recovered task', exact: true }).waitFor();
    assert.equal(taskKeys.length, 2); assert.ok(taskKeys[0]); assert.equal(taskKeys[0], taskKeys[1]);
    const tasks = await api('GET', '/tasks/collection'); assert.equal(tasks.total, 1);
    const task = tasks.items[0];
    await lost(`**/api/tasks/${task.id}`, 'PATCH');
    await widget.getByRole('checkbox', { name: 'Đánh dấu Recovered task' }).click();
    await page.waitForFunction(() => document.querySelector('.tasks-widget .task-item.completed'));
    assert.equal((await api('GET', '/tasks/' + task.id)).is_completed, true);
    await widget.getByRole('button', { name: '✓ Recovered task', exact: true }).click();
    const taskDialog = page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true });
    await taskDialog.waitFor();
    let stale = true;
    await page.route(`**/api/tasks/${task.id}?*`, async route => {
      if (route.request().method() === 'DELETE' && stale) {
        stale = false;
        const latest = await api('GET', '/tasks/' + task.id);
        await api('PATCH', '/tasks/' + task.id, { title: 'Updated before deletion', expected_version: latest.version });
      }
      await route.continue();
    });
    await taskDialog.getByRole('button', { name: 'Xóa công việc', exact: true }).click();
    await taskDialog.getByRole('button', { name: 'Xác nhận xóa công việc', exact: true }).click();
    await taskDialog.getByText(/Công việc vừa được cập nhật:/).waitFor();
    assert.equal((await api('GET', '/tasks/' + task.id)).title, 'Updated before deletion');
    await taskDialog.getByRole('button', { name: 'Xác nhận xóa công việc', exact: true }).click();
    await taskDialog.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', '/tasks/collection')).total, 0);
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Trang chủ', exact: true }).click();
    const eventKeys = await lost('**/api/calendar/events', 'POST');
    await page.locator('.calendar-widget').getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    let dialog = page.locator('.calendar-event-dialog');
    await dialog.getByLabel('Tên sự kiện', { exact: true }).fill('Recovered event');
    await dialog.locator('textarea').fill('Full description must survive summary grids');
    await dialog.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(eventKeys.length, 2); assert.equal(eventKeys[0], eventKeys[1]);
    await page.locator('.calendar-widget-event').filter({ hasText: 'Recovered event' }).click();
    await dialog.waitFor();
    assert.equal(await dialog.locator('textarea').inputValue(), 'Full description must survive summary grids');
    const eventId = await page.locator('.calendar-widget-event').filter({ hasText: 'Recovered event' }).getAttribute('data-event-id');
    const event = await api('GET', '/calendar/events/' + eventId);
    await lost(`**/api/calendar/events/${event.id}`, 'PUT');
    await dialog.getByLabel('Tên sự kiện', { exact: true }).fill('Recovered edit');
    await dialog.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', '/calendar/events/' + event.id)).title, 'Recovered edit');
    let removed = false;
    await page.route(`**/api/calendar/events/${event.id}?*`, async route => {
      if (route.request().method() !== 'DELETE' || removed) return route.continue();
      removed = true; assert.equal((await route.fetch()).status(), 204); await route.abort('failed');
    });
    await page.locator('.calendar-widget-event').filter({ hasText: 'Recovered edit' }).click();
    await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
    await dialog.getByRole('button', { name: 'Xác nhận xóa', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'DT My Note', exact: true }).click();
    const note = await api('POST', '/notes', { title: 'Guarded note' });
    await page.locator(`[data-note-id="${note.id}"]`).getByRole('button', { name: 'Xóa Guarded note', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Xóa ghi chú?', exact: true });
    let staleNote = true;
    await page.route(`**/api/notes/${note.id}`, async route => {
      if (route.request().method() === 'DELETE' && staleNote) {
        staleNote = false;
        await api('PATCH', '/notes/' + note.id, { title: 'Note changed before deletion', expected_version: note.version });
      }
      await route.continue();
    });
    await confirmation.getByRole('button', { name: 'Xóa ghi chú', exact: true }).click();
    await confirmation.getByRole('alert').waitFor();
    await confirmation.getByText('Note changed before deletion', { exact: true }).waitFor();
    assert.equal((await api('GET', '/notes/' + note.id)).title, 'Note changed before deletion');
    await confirmation.getByRole('button', { name: 'Xóa ghi chú', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    console.log('PASS: lost create responses reuse UUIDs; Task/Event edits and deletion reconcile; stale delete requires fresh confirmation; summary grids preserve full descriptions.');
  } finally { if (browser) await browser.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
