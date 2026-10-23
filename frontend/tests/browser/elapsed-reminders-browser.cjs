const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';
// Existing expired reminders represent historical data, not a new past reminder request.
const seed = `import asyncio,json,sys
from datetime import datetime,timezone
from app.core.database import async_session_maker
from app.db.models import User,Task,Note
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.notifications import Notification
from app.core.realtime import mark_changed,prepare_changes
async def run():
    account=json.load(sys.stdin)
    async with async_session_maker() as db:
        owner=await db.get(User,account['id']); assert owner and owner.username.startswith('testqa_')
        start=datetime(2000,1,1,2,tzinfo=timezone.utc); end=datetime(2000,1,1,3,tzinfo=timezone.utc)
        task=Task(user_id=owner.id,title='Expired task QA',due_date='2000-01-01',due_time='10:00',reminder_at=start)
        note=Note(user_id=owner.id,title='Expired note QA')
        event=CalendarEvent(user_id=owner.id,title='Expired event QA',starts_at=start,ends_at=end,reminder_at=start)
        linked=CalendarEvent(user_id=owner.id,title='Expired note QA',starts_at=start,ends_at=end,reminder_at=start)
        db.add_all([task,note,event,linked]); await db.flush()
        db.add(NoteCalendarSchedule(note_id=note.id,event_id=linked.id))
        db.add(Notification(user_id=owner.id,source='platform',event_key='expired-event-qa',fingerprint='qa',
            kind='event.reminder',title='Thông báo sự kiện: Expired event QA',body='Historical reminder',
            resource_type='event',resource_id=event.id,event_id=event.id,reminder_version=0,occurred_at=start,due_at=start))
        for topic in ('tasks','notes','calendar','notifications'): mark_changed(db,owner.id,topic)
        await prepare_changes(db); await db.commit()
asyncio.run(run())`;

(async () => {
  const fixture = createTestUsers(1);
  let browser;
  try {
    const seeded = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', seed], {
      cwd: path.resolve(__dirname, '../../..'), input: JSON.stringify(fixture.accounts[0]), encoding: 'utf8',
    });
    assert.equal(seeded.status, 0, seeded.stderr);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1450, height: 1100 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    const waitResponse = predicate => { const result = page.waitForResponse(predicate); result.catch(() => {}); return result; };
    const responseFor = (method, pathname) => waitResponse(r => r.request().method() === method && new URL(r.url()).pathname === pathname);
    async function editElapsed(dialog) {
      const choice = dialog.getByLabel('Thời gian thông báo', { exact: true });
      assert.ok(await choice.isEnabled());
      assert.ok(await choice.locator('option[value="custom"]').evaluate(el => !el.disabled));
      for (const option of ['0', '15', '30', '60', '1440']) assert.ok(await choice.locator(`option[value="${option}"]`).evaluate(el => el.disabled));
      await choice.selectOption('none');
      assert.ok(await choice.isEnabled(), 'Past items remain editable even after removing the reminder');
      await choice.selectOption('custom');
      assert.ok(await dialog.getByLabel('Ngày thông báo', { exact: true }).isEnabled());
      assert.ok(await dialog.getByLabel('Giờ thông báo', { exact: true }).isEnabled());
      const day = await dialog.getByLabel('Ngày thông báo', { exact: true }).inputValue();
      const time = await dialog.getByLabel('Giờ thông báo', { exact: true }).inputValue();
      assert.ok(Date.parse(day.split('/').reverse().join('-')+'T'+time+':00+07:00') > Date.now(), 'Default custom time must be future, even for a past item');
      await dialog.getByLabel('Ngày thông báo', { exact: true }).fill('01/01/2099');
      await dialog.getByLabel('Giờ thông báo', { exact: true }).fill('09:00');
      assert.equal(await dialog.getByLabel('Ngày thông báo', { exact: true }).evaluate(el => el.validity.valid), true);
    }
    // Exact reported flow: an unscheduled Note carries a past reminder into a past appointment.
    await page.getByRole('navigation',{name:'Điều hướng chính'}).getByRole('link',{name:'DT My Note',exact:true}).click();
    await page.locator('.notes-widget').getByRole('button', { name: 'Thêm', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await dialog.getByPlaceholder('Tiêu đề ghi chú...', { exact: true }).fill('Recovered past note QA');
    await dialog.getByLabel('Thời gian thông báo', { exact: true }).selectOption('custom');
    await dialog.getByLabel('Ngày thông báo', { exact: true }).fill('01/01/2000');
    await dialog.getByRole('button', { name: 'Gắn vào lịch', exact: true }).click();
    await dialog.getByLabel('Ngày bắt đầu', { exact: true }).fill('01/01/2000');
    let saved = responseFor('POST', '/api/notes');
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    assert.equal((await saved).status(), 422); // Backend continues to reject new past reminders.
    await editElapsed(dialog);
    saved = responseFor('POST', '/api/notes');
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    const noteResponse = await saved; assert.equal(noteResponse.status(), 201, await noteResponse.text());
    const savedNote = await noteResponse.json(); assert.ok(savedNote.calendar_schedule.reminder_at); assert.ok(savedNote.calendar_schedule.starts_at.startsWith('1999-12-31'));
    await dialog.waitFor({ state: 'hidden' });
    // Persisted Note with editable appointment dates still allows removing its old reminder.
    await page.locator('.notes-widget .note-title').filter({ hasText: 'Expired note QA' }).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    assert.ok(await dialog.getByLabel('Ngày bắt đầu', { exact: true }).isDisabled());
    await editElapsed(dialog);
    saved = waitResponse(r => r.request().method() === 'PATCH' && /\/api\/notes\//.test(r.url()));
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click(); assert.equal((await saved).status(), 200);
    await dialog.waitFor({ state: 'hidden' });
    // The same recovery applies to expired Task and Event detail forms.
    await page.getByRole('navigation',{name:'Điều hướng chính'}).getByRole('link',{name:'DT Task',exact:true}).click();
    await page.getByRole('button', { name: 'Sửa Expired task QA', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true });
    await editElapsed(dialog);
    saved = waitResponse(r => r.request().method() === 'PATCH' && /\/api\/tasks\//.test(r.url()));
    await dialog.getByRole('button', { name: 'Lưu công việc', exact: true }).click(); assert.equal((await saved).status(), 200);
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.notification-bell').click();
    await page.getByRole('button', { name: 'Thông báo sự kiện: Expired event QA', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Chi tiết sự kiện', exact: true });
    await editElapsed(dialog);
    saved = waitResponse(r => r.request().method() === 'PUT' && /\/api\/calendar\/events\//.test(r.url()));
    await dialog.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click(); assert.equal((await saved).status(), 200);
    await dialog.waitFor({ state: 'hidden' });
    // A future reminder carried into an invalid reschedule must also be removable.
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('dtl_platform_token'))}` };
    const created = await page.request.post(base + '/api/tasks', { headers, data: {
      title: 'Move reminder QA', due_date: '2099-01-01', due_time: '09:00', reminder_minutes: 30,
    } });
    assert.equal(created.status(), 201);
    await page.getByRole('navigation',{name:'Điều hướng chính'}).getByRole('link',{name:'DT Task',exact:true}).click();
    await page.getByRole('button', { name: 'Sửa Move reminder QA', exact: true }).click();
    const taskDialog = page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true });
    await taskDialog.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Dời lịch / Thông báo', exact: true });
    await dialog.getByLabel('Ngày đến hạn mới', { exact: true }).fill('01/01/2000');
    await editElapsed(dialog);
    saved = waitResponse(r => r.request().method() === 'POST' && /\/api\/schedule-changes\/task\//.test(r.url()));
    await dialog.locator('footer').getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click(); assert.equal((await saved).status(), 200);
    await dialog.waitFor({ state: 'hidden' });
    await taskDialog.getByRole('button', { name: 'Đóng công việc', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: past Note attachment and expired Note/Task/Event allow future reminders without rescheduling; past reminders still return 422; relative presets stay disabled; reschedule controls remain usable.');
  } finally {
    if (browser) await browser.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
