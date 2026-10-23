const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';
(async () => {
  const fixture = createTestUsers(2); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.workspace-home').waitFor();
    await page.locator('.workspace-nav-item').nth(2).click();
    const day = (await page.locator('.calendar-sr-only').textContent()).match(/\d{4}-\d{2}-\d{2}/)[0];
    const seed = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', `import asyncio,json,sys
from datetime import datetime,timedelta
from app.core.database import async_session_maker
from app.db.models import User,Task,Note
from app.db.calendar import CalendarEvent
from app.db.access import UserRole
async def run():
    data=json.load(sys.stdin)
    async with async_session_maker() as db:
        account=data['account']; user=await db.get(User,account['id'])
        assert user and user.username==account['username'] and user.username.startswith('testqa_')
        db.add(UserRole(user_id=user.id,role_id='calendar_sharer'))
        start=datetime.fromisoformat(data['day']+'T00:00:00+07:00')
        for i in range(515):
            db.add(CalendarEvent(user_id=user.id,title=f'Grid event {i:03}',starts_at=start,ends_at=start+timedelta(days=1),is_all_day=True))
            db.add(Task(user_id=user.id,title=f'Grid task {i:03}',due_date=start.date(),priority='MEDIUM'))
        db.add(Note(user_id=user.id,title='Keyboard note QA',content='Keyboard content'))
        await db.commit()
asyncio.run(run())`], { cwd: path.resolve(__dirname, '../../..'), input: JSON.stringify({ account: fixture.accounts[0], day }), encoding: 'utf8' });
    assert.equal(seed.status, 0, seed.stderr);
    await page.getByRole('button', { name: 'Làm mới lịch', exact: true }).click();
    await page.getByRole('button', { name: 'Tải thêm sự kiện và ghi chú', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tải thêm công việc', exact: true }).waitFor();
    const more = page.waitForResponse(r => r.url().includes('/api/calendar/events/collection?') && new URL(r.url()).searchParams.get('offset') === '500');
    await page.getByRole('button', { name: 'Tải thêm sự kiện và ghi chú', exact: true }).click();
    const next = await (await more).json(); assert.equal(next.items.length, 15); assert.equal(next.truncated, false);
    await page.getByRole('button', { name: 'Tải thêm sự kiện và ghi chú', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Tải thêm công việc', exact: true }).click();
    await page.locator('.calendar-load-more').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await page.locator('.calendar-agenda').waitFor();
    await page.getByRole('button', { name: 'Tải thêm sự kiện và ghi chú', exact: true }).click();
    await page.getByRole('button', { name: 'Tải thêm công việc', exact: true }).click();
    await page.locator('.calendar-load-more').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.calendar-agenda-event').count(), 515);
    const agenda = page.locator('.calendar-agenda');
    await agenda.evaluate(node => { node.scrollTop = 500; node.dataset.identityCheck = 'retained'; });
    const before = await agenda.evaluate(node => node.scrollTop); assert.ok(before > 0);
    let delayed = false;
    await page.route('**/api/calendar/events/collection?**', async route => { delayed = true; await new Promise(resolve => setTimeout(resolve, 350)); await route.continue(); });
    await page.getByRole('button', { name: 'Làm mới lịch', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.calendar-view-content')?.getAttribute('aria-busy') === 'true');
    assert.equal(await agenda.getAttribute('data-identity-check'), 'retained');
    await page.waitForFunction(() => document.querySelector('.calendar-view-content')?.getAttribute('aria-busy') === 'false');
    assert.ok(delayed); assert.equal(await agenda.evaluate(node => node.scrollTop), before);
    assert.equal(await page.locator('.calendar-agenda-event').count(), 515);
    await page.unroute('**/api/calendar/events/collection?**');
    await page.getByRole('button', { name: 'Tạo sự kiện', exact: true }).first().click();
    const dialog = page.locator('.calendar-event-dialog');
    await dialog.getByLabel('Ngày bắt đầu', { exact: true }).fill('05/01/2099');
    await dialog.getByLabel('Giờ bắt đầu', { exact: true }).fill('09:00');
    await dialog.getByLabel('Giờ kết thúc', { exact: true }).fill('10:00');
    await dialog.getByLabel('Lặp lại', { exact: true }).selectOption('DAILY');
    await dialog.getByLabel('Thời gian thông báo', { exact: true }).selectOption('15');
    assert.match(await dialog.locator('.reminder-fields').textContent(), /Thông báo tiếp theo:.*08:45.*Thông báo hằng ngày/);
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('button', { name: 'Ghi chú', exact: true }).click();
    const search = page.locator('.notes-search input');
    await search.fill('k');
    await page.getByText('Nhập ít nhất 2 ký tự để tìm kiếm.', { exact: true }).waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.getByText('Không có ghi chú phù hợp.', { exact: true }).count(), 0);
    await search.fill('Keyboard');
    const open = page.getByRole('button', { name: 'Keyboard note QA', exact: true });
    await open.waitFor(); await open.focus(); await page.keyboard.press('Enter');
    await page.locator('.note-editor-dialog').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const headers = { Authorization: `Bearer ${token}` };
    const shareResponse = await page.request.put(base + '/api/calendar-sharing/mine/' + fixture.accounts[1].id, { headers, data: { expected_version: 0, share_events: true, share_tasks: true, share_notes: true } });
    assert.ok(shareResponse.ok(), await shareResponse.text()); const grant = await shareResponse.json();
    const viewer = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    viewer.setDefaultTimeout(20000); viewer.on('pageerror', error => errors.push(error.message));
    await viewer.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await viewer.goto(base);
    await viewer.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[1].username);
    await viewer.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[1].password);
    await viewer.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await viewer.locator('.workspace-home').waitFor(); await viewer.locator('.workspace-nav-item').nth(2).click();
    await viewer.getByRole('button', { name: /Test QA.*Chỉ xem/ }).click();
    await viewer.locator('.shared-calendar-page').waitFor();
    await viewer.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await viewer.getByRole('button', { name: 'Tải thêm', exact: true }).waitFor().catch(async error => { console.log('SHARED_DEBUG', await viewer.locator('.shared-calendar-page').innerText()); throw error; });
    for (const offset of [500, 1000]) {
      const response = viewer.waitForResponse(r => r.url().includes('/api/calendar-sharing/view/') && new URL(r.url()).searchParams.get('offset') === String(offset));
      await viewer.getByRole('button', { name: 'Tải thêm', exact: true }).click();
      const batch = await (await response).json(); assert.equal(batch.total, 1030);
      await viewer.waitForFunction(() => !document.querySelector('.shared-calendar-content') || document.querySelector('.shared-calendar-content').getAttribute('aria-busy') === 'false');
    }
    await viewer.getByRole('button', { name: 'Tải thêm', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await viewer.locator('[data-shared-id]').count(), 1030);
    const revoked = await page.request.delete(base + `/api/calendar-sharing/mine/${fixture.accounts[1].id}?expected_version=${grant.version}&expected_id=${grant.id}`, { headers });
    assert.equal(revoked.status(), 204);
    await viewer.locator('.shared-calendar-page').waitFor({ state: 'hidden' });
    assert.equal(await viewer.locator('[data-shared-id]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS server pagination beyond 500 events/tasks, retained loaded pages and agenda scroll on refresh, explicit recurring reminder time, single-character search state, keyboard note opening, shared pagination and immediate removal after grant revocation.');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
