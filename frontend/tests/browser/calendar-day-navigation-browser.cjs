const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';
const seed = `import asyncio,sys
from datetime import datetime,timezone
from app.core.database import async_session_maker
from app.db.access import UserRole
from app.db import calendar
from app.db.notifications import Notification
async def main():
    async with async_session_maker() as db:
        db.add(UserRole(user_id=sys.argv[1],role_id='calendar_sharer'))
        db.add(UserRole(user_id=sys.argv[2],role_id='access_admin'))
        for i in range(3):
            db.add(Notification(user_id=sys.argv[1],source='workflows',event_key='day-navigation-'+str(i),fingerprint='qa',kind='external.info',title='Day navigation QA '+str(i),body='Browser regression',resource_type='workflows.record',resource_id=str(i),occurred_at=datetime.now(timezone.utc)))
        await db.commit()
asyncio.run(main())`;

(async () => {
  const fixture = createTestUsers(2);
  let browser;
  try {
    const prepared = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', seed, fixture.accounts[0].id, fixture.accounts[1].id], {
      cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8',
    });
    assert.equal(prepared.status, 0, prepared.stderr);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const errors = [];
    const login = async account => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
      await page.goto(base);
      await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
      await page.waitForURL('**/homepage');
      return page;
    };
    const owner = await login(fixture.accounts[0]);
    const api = async (page, method, endpoint, body) => {
      const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
      const response = await page.request.fetch(base + '/api/' + endpoint, {
        method, headers: { Authorization: `Bearer ${token}` }, data: body,
      });
      assert.ok(response.ok(), `${method} ${endpoint}: ${await response.text()}`);
      return response.status() === 204 ? null : response.json();
    };
    await owner.waitForFunction(() => document.title === '(3) Đông Tây One');
    await owner.getByRole('button', { name: 'Thông báo, 3 chưa đọc', exact: true }).waitFor();

    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => parts.find(value => value.type === type).value;
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    const schedule = { starts_at: `${day}T09:00:00+07:00`, ends_at: `${day}T10:00:00+07:00`, is_all_day: false };
    await api(owner, 'POST', 'calendar/events', { title: 'QA day event', ...schedule });
    await api(owner, 'POST', 'notes', { title: 'QA day note', content: 'Day note detail', calendar_schedule: schedule });
    await api(owner, 'POST', 'tasks', { title: 'QA day task', due_date: day, due_time: '11:00' });
    await api(owner, 'PUT', 'calendar-sharing/mine/' + fixture.accounts[1].id, {
      share_events: true, share_notes: true, share_tasks: true, expected_version: 0,
    });

    await owner.goto(`${base}/calendar?date=${day}`);
    await owner.waitForFunction(() => document.title === '(3) DT Calendar');
    await owner.locator('.calendar-week-day button').filter({ hasText: new RegExp(`^${Number(part('day'))}$`) }).click();
    const list = owner.locator('.calendar-day-dialog');
    for (const [title, detailName, closeName] of [
      ['QA day event', 'Chi tiết sự kiện', 'Đóng'],
      ['QA day note', null, 'Đóng ghi chú'],
      ['QA day task', 'Chi tiết công việc', 'Đóng công việc'],
    ]) {
      const row = list.getByRole('button').filter({ hasText: title });
      await row.click();
      const detail = detailName ? owner.getByRole('dialog', { name: detailName, exact: true }) : owner.locator('dialog.note-editor-dialog');
      await detail.waitFor();
      assert.equal(await list.evaluate(node => node.open), true, 'Day list stays mounted under detail');
      await detail.getByRole('button', { name: closeName, exact: true }).click();
      await row.click();
      await detail.waitFor();
      await detail.getByRole('button', { name: closeName, exact: true }).click();
      assert.equal(await list.evaluate(node => node.open), true);
    }
    // Saving a detail refreshes the still-open list.
    await list.getByRole('button').filter({ hasText: 'QA day event' }).click();
    const event = owner.getByRole('dialog', { name: 'Chi tiết sự kiện', exact: true });
    await event.getByLabel('Tên sự kiện').fill('QA day event updated');
    await event.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click();
    await list.getByRole('button').filter({ hasText: 'QA day event updated' }).waitFor();
    await owner.setViewportSize({ width: 390, height: 844 });
    await list.getByRole('button').filter({ hasText: 'QA day task' }).click();
    await owner.getByRole('button', { name: 'Đóng công việc', exact: true }).click();
    assert.equal(await list.evaluate(node => node.open), true, 'Mobile detail returns to the day list');
    assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await list.getByRole('button', { name: 'Đóng danh sách trong ngày' }).click();
    await owner.setViewportSize({ width: 1440, height: 1000 });

    const viewer = await login(fixture.accounts[1]);
    assert.equal(await viewer.title(), 'Đông Tây One', 'No unread count leaks between accounts');
    await viewer.goto(`${base}/calendar?owner=${fixture.accounts[0].id}&date=${day}`);
    await viewer.locator('.shared-calendar-content .calendar-week-day button').filter({ hasText: new RegExp(`^${Number(part('day'))}$`) }).click();
    const sharedList = viewer.locator('.calendar-day-dialog');
    for (const title of ['QA day event updated', 'QA day note', 'QA day task']) {
      await sharedList.getByRole('button').filter({ hasText: title }).click();
      const detail = viewer.locator('.calendar-sharing-dialog');
      await detail.waitFor();
      assert.equal(await sharedList.evaluate(node => node.open), true);
      await detail.getByRole('button', { name: 'Đóng', exact: true }).click();
      await sharedList.getByRole('button').filter({ hasText: title }).click();
      await detail.getByRole('button', { name: 'Đóng', exact: true }).click();
    }
    await sharedList.getByRole('button', { name: 'Đóng danh sách trong ngày' }).click();

    // A real assignment creates a notification and sends SSE to the owner's
    // existing calendar tab. No reload, focus or client invalidation is used.
    const assigned = await api(viewer, 'POST', 'tasks', {
      title: 'QA realtime assignment', assignee_id: fixture.accounts[0].id,
    });
    await owner.waitForFunction(() => document.title === '(4) DT Calendar');
    await owner.getByRole('button', { name: 'Thông báo, 4 chưa đọc', exact: true }).waitFor();
    const notices = await api(owner, 'GET', 'notifications');
    const incoming = notices.items.find(item => item.resource_id === assigned.id);
    assert.ok(incoming, 'Assignment notification was delivered');
    // Reading in another session/request also propagates through SSE.
    await api(owner, 'PATCH', `notifications/${incoming.id}`, { read: true });
    await owner.waitForFunction(() => document.title === '(3) DT Calendar');
    await owner.getByRole('button', { name: 'Thông báo, 3 chưa đọc', exact: true }).waitFor();

    await owner.goto(base + '/notifications');
    await owner.waitForFunction(() => document.title === '(3) Thông báo');
    const readAllUrl = '**/api/notifications/read-all';
    let failedAttempts = 0;
    const unavailable = route => { failedAttempts++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Dịch vụ tạm thời chưa sẵn sàng.' }) }); };
    await owner.route(readAllUrl, unavailable);
    await owner.getByRole('button', { name: 'Đánh dấu tất cả đã đọc', exact: true }).click();
    await owner.locator('.notifications-page').getByRole('alert').filter({ hasText: 'Dịch vụ tạm thời chưa sẵn sàng.' }).waitFor();
    assert.equal(failedAttempts, 2, '503 retries once, then reports the error');
    assert.equal(await owner.title(), '(3) Thông báo', 'Failed requests do not clear unread notices');
    await owner.unroute(readAllUrl, unavailable);

    const attempts = [];
    const temporarilyBusy = route => {
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Dịch vụ tạm thời chưa sẵn sàng.' }) });
      return route.continue();
    };
    await owner.route(readAllUrl, temporarilyBusy);
    const readAllResponse = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/notifications/read-all' && response.request().method() === 'POST' && response.status() === 204);
    await owner.getByRole('button', { name: 'Đánh dấu tất cả đã đọc', exact: true }).click();
    const readAll = await readAllResponse;
    assert.equal(readAll.status(), 204, readAll.status() === 204 ? undefined : await readAll.text());
    await owner.waitForFunction(() => document.title === 'Thông báo');
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0], 'Retry preserves the original cutoff');
    await owner.unroute(readAllUrl, temporarilyBusy);
    await owner.getByRole('button', { name: 'Thông báo', exact: true }).waitFor();
    await owner.getByRole('button', { name: /^Đánh dấu chưa đọc:/ }).first().click();
    await owner.waitForFunction(() => document.title === '(1) Thông báo');
    await owner.goto(base + '/homepage');
    await owner.waitForFunction(() => document.title === '(1) Đông Tây One');
    await owner.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await owner.waitForURL('**/login');
    await owner.waitForFunction(() => document.title === 'Đông Tây One');
    assert.deepEqual(errors, []);
    console.log('PASS: title prefix and bell count synchronize across routes, new SSE deliveries, remote reads and read-all; personal/shared day navigation, saves and mobile layout work.');
  } finally {
    await browser?.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
