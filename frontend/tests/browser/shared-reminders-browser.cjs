const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { deliverReminders } = require('../support/deliver-reminders.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';
const setup = `import asyncio,json,sys
from app.core.database import async_session_maker
from app.db.models import User
from app.db.access import UserRole
async def run():
    accounts=json.load(sys.stdin)
    async with async_session_maker() as db:
        for account in accounts:
            user=await db.get(User,account['id'])
            assert user and user.username.startswith('testqa_')
        owner=await db.get(User,accounts[0]['id']); owner.job_title='Tổng Giám Đốc'
        db.add(UserRole(user_id=owner.id,role_id='calendar_sharer'))
        await db.commit()
asyncio.run(run())`;

(async () => {
  const fixture = createTestUsers(2);
  let browser;
  try {
    const seeded = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', setup], {
      cwd: path.resolve(__dirname, '../../..'), input: JSON.stringify(fixture.accounts), encoding: 'utf8',
    });
    assert.equal(seeded.status, 0, seeded.stderr);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const sessions = [];
    for (const account of fixture.accounts) {
      const context = await browser.newContext({ viewport: { width: 1450, height: 1000 } });
      await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
      const page = await context.newPage();
      await page.goto(base);
      await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
      await page.locator('.calendar-widget').waitFor();
      const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
      sessions.push({ context, page, headers: { Authorization: `Bearer ${token}` } });
    }
    const [owner, viewer] = sessions;
    const call = async (session, method, url, data, status = 200) => {
      const response = await session.context.request.fetch(base + url, { method, headers: session.headers, data });
      assert.equal(response.status(), status, await response.text());
      return status === 204 ? undefined : response.json();
    };
    const grant = await call(owner, 'PUT', '/api/calendar-sharing/mine/' + fixture.accounts[1].id,
      { expected_version: 0, share_events: true, share_tasks: true, share_notes: true });
    const taskData = { due_date: '2099-01-01', due_time: '09:00', reminder_minutes: 30 };
    const task = await call(owner, 'POST', '/api/tasks', { ...taskData, title: 'CEO public task' }, 201);
    await call(owner, 'POST', '/api/tasks', { ...taskData, title: 'CEO private task', is_private: true }, 201);
    const schedule = { starts_at: '2099-01-01T02:00:00Z', ends_at: '2099-01-01T03:00:00Z', is_all_day: false, reminder_minutes: 30 };
    await call(owner, 'POST', '/api/calendar/events', { ...schedule, title: 'CEO event' }, 201);
    await call(owner, 'POST', '/api/notes', { title: 'CEO note', calendar_schedule: schedule }, 201);
    await call(viewer, 'POST', '/api/tasks', { ...taskData, title: 'Secretary own task' }, 201);
    deliverReminders(fixture.accounts[0]);
    deliverReminders(fixture.accounts[1]);
    const ownerFeed = await call(owner, 'GET', '/api/notifications');
    const viewerFeed = await call(viewer, 'GET', '/api/notifications');
    assert.equal(ownerFeed.items.length, 4);
    assert.equal(viewerFeed.items.length, 5); // Three shared, one own, one share invitation.
    for (const session of sessions) {
      await session.page.getByRole('button', { name: /^Thông báo,/ }).click();
      await session.page.locator('.notification-card').first().waitFor();
    }
    assert.equal(await owner.page.locator('.notification-meta').filter({ hasText: 'Của bạn' }).count(), 0);
    assert.equal(await viewer.page.locator('.notification-meta').filter({ hasText: 'Của Tổng Giám Đốc' }).count(), 3);
    assert.equal(await viewer.page.locator('.notification-meta').filter({ hasText: 'Của bạn' }).count(), 1);
    assert.equal(await viewer.page.getByRole('button', { name: 'Nhắc công việc: CEO private task', exact: true }).count(), 0);
    await call(owner, 'PATCH', '/api/tasks/' + task.id, { expected_version: task.version, is_private: true });
    await viewer.page.getByRole('button', { name: 'Nhắc công việc: CEO public task', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await owner.page.getByRole('button', { name: 'Nhắc công việc: CEO public task', exact: true }).count(), 1);
    await call(owner, 'DELETE', `/api/calendar-sharing/mine/${fixture.accounts[1].id}?expected_version=${grant.version}&expected_id=${grant.id}`, undefined, 204);
    await viewer.page.getByRole('button', { name: 'Nhắc sự kiện: CEO event', exact: true }).waitFor({ state: 'detached' });
    await viewer.page.waitForFunction(() => ![...document.querySelectorAll('.notification-meta')].some(node => /Của bạn|Của Tổng Giám Đốc/.test(node.textContent)));
    assert.equal(await viewer.page.getByRole('button', { name: 'Nhắc công việc: Secretary own task', exact: true }).count(), 1);
    console.log('PASS: two accounts, directional reminders, ownership labels, private items, live privacy/revoke updates without reloading.');
  } finally {
    if (browser) await browser.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
