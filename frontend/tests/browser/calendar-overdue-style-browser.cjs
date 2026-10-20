const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const fixture = createTestUsers(2); let browser;
  try {
    const login = await fetch('http://127.0.0.1:8000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.accounts[0]) });
    const { access_token } = await login.json();
    const api = async (route, data) => {
      const response = await fetch('http://127.0.0.1:8000/api/' + route, { method: 'POST', headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      assert.equal(response.status, 201); return response.json();
    };
    const timed = await api('tasks', { title: 'Deadline remains after 09:00', due_date: '2026-10-20', due_time: '09:00' });
    const untimed = await api('tasks', { title: 'Yesterday all-day overdue', due_date: '2026-10-19' });
    const note = await api('notes', { title: 'Dashed all-day note', calendar_schedule: { starts_at: '2026-10-19T00:00:00+07:00', ends_at: '2026-10-23T00:00:00+07:00', is_all_day: true } });
    const timedNote = await api('notes', { title: 'Dashed timed note', calendar_schedule: { starts_at: '2026-10-20T10:00:00+07:00', ends_at: '2026-10-20T11:00:00+07:00', is_all_day: false } });
    const event = await api('calendar/events', { title: 'Solid all-day event', starts_at: '2026-10-19T00:00:00+07:00', ends_at: '2026-10-23T00:00:00+07:00', is_all_day: true });
    const grant = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', `import asyncio,json,sys
from app.core.database import async_session_maker
from app.db.models import User
from app.db.task_reminders import TaskReminderReceipt
from app.db.access import UserRole,CalendarShare
async def run():
 accounts=json.load(sys.stdin)
 async with async_session_maker() as db:
  db.add(UserRole(user_id=accounts[0]['id'],role_id='calendar_sharer'))
  db.add(CalendarShare(owner_id=accounts[0]['id'],viewer_id=accounts[1]['id'],share_events=True,share_tasks=True,share_notes=True))
  await db.commit()
asyncio.run(run())`], { cwd: path.resolve(__dirname, '../../..'), input: JSON.stringify(fixture.accounts), encoding: 'utf8' });
    assert.equal(grant.status, 0, grant.stderr);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const errors = [];
    const open = async account => {
      const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
      const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-10-20T01:59:30Z') });
      await page.goto('http://127.0.0.1:5173');
      await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
      await page.locator('.calendar-widget').waitFor(); return page;
    };
    const page = await open(fixture.accounts[0]);
    const widget = page.locator('.calendar-widget');
    const dayDeadline = widget.locator(`[data-calendar-group="deadlines"] [data-deadline-id="${timed.id}"]`);
    await dayDeadline.waitFor();
    await page.clock.fastForward(120000);
    await page.waitForFunction(id => document.querySelector(`.calendar-widget [data-calendar-group="deadlines"] [data-deadline-id="${id}"]`)?.classList.contains('is-overdue'), timed.id);
    await widget.getByRole('button', { name: 'Ngày trước', exact: true }).click();
    await widget.locator(`[data-calendar-group="deadlines"] [data-deadline-id="${untimed.id}"]`).waitFor();
    await widget.getByRole('button', { name: 'Mở lịch đầy đủ', exact: true }).click();
    const calendar = page.locator('.calendar-page');
    const timedRow = calendar.locator(`.calendar-time-column[data-date="2026-10-20"] [data-deadline-id="${timed.id}"]`);
    await timedRow.waitFor(); assert.ok(await timedRow.evaluate(node => node.classList.contains('is-overdue')));
    await calendar.locator(`.calendar-week-all-day [data-deadline-id="${untimed.id}"]`).waitFor();
    const bar = calendar.locator(`button.calendar-all-day-span[data-event-id="${note.calendar_schedule.event_id}"]`);
    const segments = bar.locator('.calendar-all-day-segments > span'); await segments.first().waitFor();
    assert.ok((await segments.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopStyle))).every(style => style === 'dashed'));
    const solid = calendar.locator(`button.calendar-all-day-span[data-event-id="${event.id}"] .calendar-all-day-segments > span`);
    assert.ok((await solid.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopStyle))).every(style => style === 'solid'));
    const timedCard = calendar.locator(`.calendar-time-column button[data-event-id="${timedNote.calendar_schedule.event_id}"]`);
    assert.equal(await timedCard.evaluate(node => getComputedStyle(node).borderLeftStyle), 'dashed');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--calendar-status-strength').trim()), '1.3');
    for (const theme of ['light', 'obsidian']) {
      await page.getByRole('button', { name: 'Chọn giao diện', exact: true }).click();
      await page.locator(`[data-choice="${theme}"]`).click(); await page.keyboard.press('Escape');
      assert.ok(await timedRow.isVisible());
      assert.equal(await timedCard.evaluate(node => {
        const style = getComputedStyle(node), reference = document.createElement('div');
        reference.style.background = `color-mix(in srgb, ${style.getPropertyValue('--event-color')} 18.2%, ${style.getPropertyValue('--bg-card-solid')})`;
        document.body.append(reference); const matches = getComputedStyle(reference).backgroundColor === style.backgroundColor; reference.remove(); return matches;
      }), true);
    }
    for (const label of ['Tháng', 'Danh sách']) {
      await calendar.getByRole('button', { name: label, exact: true }).click();
      const region = calendar.locator(label === 'Tháng' ? '.calendar-month-grid' : '.calendar-agenda');
      await region.locator(`[data-deadline-id="${timed.id}"]`).waitFor();
      await region.locator(`[data-deadline-id="${untimed.id}"]`).waitFor();
    }
    const viewer = await open(fixture.accounts[1]);
    await viewer.getByRole('button', { name: 'Lịch', exact: true }).click();
    await viewer.locator('.sharing-calendar-choice').filter({ hasText: 'Test QA' }).click();
    const shared = viewer.locator('.shared-calendar-page');
    await shared.locator(`.calendar-time-column [data-shared-id="${timed.id}"]`).waitFor();
    await shared.locator(`.calendar-week-all-day [data-shared-id="${untimed.id}"]`).waitFor();
    const sharedSegments = shared.locator(`[data-shared-id="${note.calendar_schedule.event_id}"] .calendar-all-day-segments > span`);
    assert.ok((await sharedSegments.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopStyle))).every(style => style === 'dashed'));
    assert.deepEqual(errors, []);
    console.log('PASS: deadlines remain after expiry across widget/week/month/agenda/shared; Notes dashed in both layouts; 30% tint in light/dark');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
