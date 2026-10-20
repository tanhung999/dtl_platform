const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const seed = `import asyncio,json,sys
from datetime import datetime,timezone
from app.core.database import async_session_maker
from app.db.models import User
from app.db.task_reminders import TaskReminderReceipt
from app.db.notifications import Notification
from app.core.realtime import prepare_changes,mark_changed
async def run():
    user_id=json.load(sys.stdin)['id']
    async with async_session_maker() as db:
        for i in range(60):
            source=('bookingreports','workflows','itam')[i%3]
            db.add(Notification(user_id=user_id,source=source,event_key='qa-'+str(i),fingerprint='qa',kind='external.info',title='Inbox QA '+str(i),body='Private notification',resource_type=source+'.record',resource_id=str(i),occurred_at=datetime.now(timezone.utc)))
        mark_changed(db,user_id,'notifications')
        await prepare_changes(db)
        await db.commit()
asyncio.run(run())`;

(async () => {
  const fixture = createTestUsers(2);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1450, height: 1000 } });
    let page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const headers = { Authorization: `Bearer ${token}` };
    // No page exists while the server records and delivers this overdue task.
    await page.close();
    const created = await context.request.post('http://127.0.0.1:5173/api/tasks', { headers, data: { title: 'Offline QA task', due_date: '2026-01-01', due_time: '16:00' } });
    assert.equal(created.status(), 201);
    const task = await created.json();
    let items = [];
    for (let i = 0; i < 22; i++) {
      items = (await (await context.request.get('http://127.0.0.1:5173/api/notifications', { headers })).json()).items;
      if (items.length) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(items.length, 1); assert.equal(items[0].kind, 'task.overdue');
    page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await page.getByRole('button', { name: 'Thông báo, 1 chưa đọc', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Thông báo, 1 chưa đọc', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Thông báo', exact: true });
    await dialog.locator('.notification-card').waitFor();
    await dialog.getByRole('button', { name: /^Ẩn thông báo:/ }).click();
    await dialog.getByText('Chưa có thông báo.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Xem tất cả thông báo' }).click();
    const full = page.locator('.notifications-page');
    await full.getByRole('button', { name: 'Đã ẩn', exact: true }).click();
    await full.locator('.notification-card').waitFor();
    await full.getByRole('button', { name: /^Khôi phục thông báo:/ }).click();
    await full.getByRole('button', { name: 'Tất cả', exact: true }).click();
    await full.locator('.notification-card').waitFor();
    await full.getByRole('button', { name: /^Đánh dấu đã đọc:/ }).click();
    await page.waitForFunction(() => document.querySelector('.notification-bell')?.getAttribute('aria-label') === 'Thông báo');
    const unchanged = await (await context.request.get('http://127.0.0.1:5173/api/tasks/' + task.id, { headers })).json();
    assert.equal(unchanged.version, task.version); assert.equal(unchanged.is_completed, false);

    const result = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', seed], { cwd: path.resolve(__dirname, '../../..'), input: JSON.stringify(fixture.accounts[0]), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    // PG NOTIFY -> SSE -> summary/feed, without focus or refresh.
    await page.getByRole('button', { name: 'Thông báo, 60 chưa đọc', exact: true }).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.notifications-feed .notification-card').length === 25);
    const first = await full.locator('.notification-card').evaluateAll(nodes => nodes.map(n => n.dataset.notificationId));
    await full.getByRole('button', { name: 'Trang sau', exact: true }).click();
    await full.getByText('Trang 2', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.notifications-feed .notification-card').length === 25);
    const second = await full.locator('.notification-card').evaluateAll(nodes => nodes.map(n => n.dataset.notificationId));
    assert.equal(new Set([...first, ...second]).size, 50);
    await full.getByRole('button', { name: 'Xem mới nhất' }).click();
    await full.getByLabel('Nguồn', { exact: true }).selectOption('workflows');
    await page.waitForFunction(() => document.querySelectorAll('.notifications-feed .notification-card').length === 20);
    await full.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await full.getByText('Chưa kết nối', { exact: true }).first().waitFor();
    await full.getByRole('button', { name: 'Đánh dấu tất cả đã đọc', exact: true }).click();
    await page.getByRole('button', { name: 'Thông báo', exact: true }).waitFor();
    await page.screenshot({ path: '../.audit-backups/notifications-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Thông báo', exact: true }).click();
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
    await page.screenshot({ path: '../.audit-backups/notifications-mobile.png', fullPage: true });
    await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible()); await dialog.getByRole('button', { name: 'Đóng thông báo' }).click(); await dialog.waitFor({ state: 'hidden' });
    console.log('PASS: offline durable delivery, read/hide/restore, Tasks unchanged, SSE, cursor paging, source filtering, preferences, mobile bell and Escape.');
  } finally {
    if (browser) await browser.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
