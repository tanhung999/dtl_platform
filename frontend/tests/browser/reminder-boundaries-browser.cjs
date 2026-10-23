const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { deliverReminders } = require('../support/deliver-reminders.cjs');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(1);
  let browser, release;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1450, height: 1100 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    await page.clock.install({ time: new Date('2099-01-01T09:59:30+07:00') });
    const choice = root => root.getByLabel('Thời gian thông báo', { exact: true });
    const watch = predicate => { const promise = page.waitForResponse(predicate); promise.catch(() => {}); return promise; };
    // A minute-only picker cannot choose any time strictly before an end in 30 seconds.
    await page.locator('.calendar-widget').getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Tạo sự kiện mới', exact: true });
    for (const name of ['Ngày bắt đầu', 'Ngày kết thúc']) await dialog.getByLabel(name, { exact: true }).fill('01/01/2099');
    await dialog.getByLabel('Giờ bắt đầu', { exact: true }).fill('09:00');
    await dialog.getByLabel('Giờ kết thúc', { exact: true }).fill('10:00');
    assert.ok(await choice(dialog).locator('option[value="custom"]').evaluate(el => el.disabled));
    await dialog.getByText('Không còn phút thông báo hợp lệ', { exact: false }).waitFor();
    await page.clock.runFor(31000);
    assert.ok(await choice(dialog).locator('option[value="custom"]').evaluate(el => !el.disabled));
    await choice(dialog).selectOption('custom');
    assert.ok((await dialog.getByLabel('Giờ thông báo', { exact: true }).inputValue()) > '10:00');
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    // Without a deadline, an empty/past reminder must be fixable in the same form.
    await page.locator('.notes-widget').getByRole('button', { name: 'Thêm', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await dialog.getByPlaceholder('Tiêu đề ghi chú...', { exact: true }).fill('Boundary standalone QA');
    await choice(dialog).selectOption('custom');
    await dialog.getByLabel('Ngày thông báo', { exact: true }).fill('');
    assert.equal(await dialog.getByLabel('Ngày thông báo', { exact: true }).evaluate(el => el.validity.valid), false);
    await dialog.getByLabel('Ngày thông báo', { exact: true }).fill('01/01/2000');
    let response = watch(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/notes');
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    assert.equal((await response).status(), 422);
    assert.ok(await choice(dialog).isEnabled());
    assert.ok(await dialog.getByLabel('Ngày thông báo', { exact: true }).isEnabled());
    await dialog.getByLabel('Ngày thông báo', { exact: true }).fill('02/01/2099');
    await dialog.getByLabel('Giờ thông báo', { exact: true }).fill('09:00');
    response = watch(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/notes');
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    const created = await response; assert.equal(created.status(), 201, await created.text());
    const note = await created.json(); assert.equal(note.calendar_schedule, null);
    await dialog.waitFor({ state: 'hidden' });
    await page.locator(`[data-note-id="${note.id}"] .note-title`).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await choice(dialog).waitFor();
    await dialog.getByLabel('Ngày thông báo', { exact: true }).fill('03/01/2099');
    let started;
    const committed = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let writes = 0;
    await page.route('**/api/notes/' + note.id, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      writes++;
      await route.fetch(); // Commit the real update before losing its response.
      started(); await gate; await route.abort('failed');
    });
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    await committed;
    assert.ok(await choice(dialog).isDisabled());
    assert.ok(await dialog.getByLabel('Ngày thông báo', { exact: true }).isDisabled());
    release(); release = undefined;
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes, 1);
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const current = await (await page.request.get(base + '/api/notes/' + note.id, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.ok(current.reminder_at.startsWith('2099-01-03')); assert.equal(current.calendar_schedule, null);
    deliverReminders(fixture.accounts[0]);
    const notices = await (await page.request.get(base + '/api/notifications', { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(notices.items.length, 1, 'Replacing a reminder and recovering a lost response must not duplicate delivery');
    console.log('PASS: minute/end boundary, automatic re-enable after end, undated Note empty/past/future validation, busy locks, and lost PATCH response recovery without duplicate reminders.');
  } finally {
    release?.();
    if (browser) await browser.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
