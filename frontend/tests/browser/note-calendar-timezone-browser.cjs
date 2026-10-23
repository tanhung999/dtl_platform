const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
(async () => {
  const fixture = createTestUsers(3); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const zones = ['Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati'];
    for (let index = 0; index < zones.length; index++) {
      const context = await browser.newContext({ timezoneId: zones[index], viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      await page.clock.install({ time: new Date('2026-10-22T05:00:00Z') });
      await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[index].username);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[index].password);
      await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
      await page.locator('.workspace-nav-item').nth(4).click();
      await page.locator('.notes-widget').getByRole('button', { name: 'Thêm', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
      const title = 'Timezone note ' + zones[index];
      await editor.getByPlaceholder('Tiêu đề ghi chú...').fill(title);
      await editor.getByRole('button', { name: 'Gắn vào lịch', exact: true }).click();
      await editor.getByRole('checkbox', { name: 'Ghi chú cả ngày', exact: true }).check();
      await editor.getByLabel('Ngày bắt đầu', { exact: true }).fill('22/10/2026');
      await editor.getByLabel('Ngày kết thúc', { exact: true }).fill('25/10/2026');
      const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/notes');
      await editor.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
      const response = await created; assert.equal(response.status(), 201); const note = await response.json();
      assert.equal(Date.parse(note.calendar_schedule.starts_at), Date.parse('2026-10-21T17:00:00Z'));
      assert.equal(Date.parse(note.calendar_schedule.ends_at), Date.parse('2026-10-25T17:00:00Z'));
      assert.match(note.created_at, /(Z|[+-]\d{2}:\d{2})$/);
      await editor.waitFor({ state: 'hidden' });
      const card = page.locator('.note-card').filter({ hasText: title }); await card.waitFor();
      assert.ok((await card.locator('.note-event-date').innerText()).includes('22/10'));
      await page.getByRole('button', { name: 'Lịch', exact: true }).click();
      const bar = page.locator('.calendar-all-day-span[data-event-id="' + note.calendar_schedule.event_id + '"]');
      await bar.waitFor();
      // Mon 19..Sun 25: start in Thu 22, cover four days, never Wed 21.
      assert.equal(await bar.locator('..').evaluate(el => el.style.gridColumn), '5 / span 4');
      await bar.click();
      await editor.waitFor();
      assert.equal(await editor.getByLabel('Ngày bắt đầu', { exact: true }).inputValue(), '22/10/2026');
      assert.equal(await editor.getByLabel('Ngày kết thúc', { exact: true }).inputValue(),'25/10/2026');
      assert.ok(await editor.getByLabel('Ngày kết thúc', { exact: true }).isDisabled());
      await editor.getByRole('button', { name: 'Đóng ghi chú', exact: true }).click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.workspace-nav-item').nth(4).click();await page.locator('.note-card').filter({ hasText: title }).waitFor();
      await page.getByRole('button', { name: 'Lịch', exact: true }).click(); await bar.waitFor();
      assert.equal(await bar.locator('..').evaluate(el => el.style.gridColumn), '5 / span 4');
      console.log('PASS all-day 22–25 October UI/save/reopen/reload: ' + zones[index]);
      await context.close();
    }
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
