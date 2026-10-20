const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const fixture = createTestUsers(1); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:5173';
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    assert.equal(await page.getByRole('switch').count(), 0);
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async (method, route, data) => {
      const response = await page.request.fetch(base + '/api/' + route, { method, data, headers: { Authorization: `Bearer ${token}` } });
      assert.ok(response.ok(), `${route}: ${response.status()} ${await response.text()}`);
      return response.status() === 204 ? null : response.json();
    };
    const task = await api('POST', 'tasks', { title: 'Privacy QA task' });
    const note = await api('POST', 'notes', { title: 'Privacy QA note', content: 'Keep my text' });
    const staysOpen = async dialog => {
      await dialog.waitFor(); await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible());
      await page.mouse.click(2, 2); assert.ok(await dialog.isVisible());
    };
    const openTask = async () => { await page.getByRole('button', { name: 'Sửa Privacy QA task', exact: true }).click(); return page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true }); };
    await page.reload(); await page.getByRole('button', { name: 'Sửa Privacy QA task', exact: true }).waitFor();
    let dialog = await openTask(); await staysOpen(dialog); assert.equal(await dialog.getByRole('switch').count(), 0);
    await dialog.getByRole('button', { name: 'Đóng công việc', exact: true }).click();
    await page.locator(`[data-note-id="${note.id}"] .note-title`).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true }); await staysOpen(dialog);
    assert.equal(await dialog.getByRole('switch').count(), 0);
    await dialog.getByRole('button', { name: 'Đóng ghi chú', exact: true }).click();
    const script = `import asyncio,sys
from app.core.database import async_session_maker
from app.db.access import UserRole
from app.db.task_reminders import TaskReminderReceipt
async def run():
 async with async_session_maker() as db:
  db.add(UserRole(user_id=sys.argv[1],role_id='calendar_sharer'))
  await db.commit()
asyncio.run(run())`;
    const result = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', script, fixture.accounts[0].id], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    await page.reload(); await page.getByRole('switch', { name: 'Công việc mới riêng tư', exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Công việc mới riêng tư', exact: true }).isChecked(), false);
    dialog = await openTask();
    await dialog.getByRole('switch', { name: 'Công việc riêng tư', exact: true }).check();
    await dialog.getByRole('button', { name: 'Lưu công việc', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', 'tasks/' + task.id)).is_private, true);
    await page.locator(`[data-note-id="${note.id}"] .note-title`).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    assert.equal(await dialog.getByRole('switch', { name: 'Ghi chú riêng tư' }).isChecked(), false);
    await dialog.getByRole('switch', { name: 'Ghi chú riêng tư' }).check();
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', 'notes/' + note.id)).is_private, true);
    await page.locator(`[data-note-id="${note.id}"] .note-title`).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    assert.equal(await dialog.getByRole('switch', { name: 'Ghi chú riêng tư' }).isChecked(), true);
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', 'notes/' + note.id)).is_private, true);
    await page.getByRole('button', { name: 'Lịch', exact: true }).click();
    await page.getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    dialog = page.locator('.calendar-event-dialog'); await staysOpen(dialog);
    assert.equal(await dialog.getByRole('switch', { name: 'Sự kiện riêng tư' }).isChecked(), false);
    await dialog.getByRole('button', { name: 'Chọn ngày bắt đầu', exact: true }).click();
    await dialog.locator('.app-date-popover').waitFor();
    await dialog.getByLabel('Tên sự kiện', { exact: true }).click();
    await dialog.locator('.app-date-popover').waitFor({ state: 'hidden' }); assert.ok(await dialog.isVisible());
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: conditional/default-off privacy for Task/Note/Event, saved values, outside/Escape blocked and date picker still dismisses.');
  } finally { if (browser) await browser.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
