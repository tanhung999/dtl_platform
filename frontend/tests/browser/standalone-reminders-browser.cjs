const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { deliverReminders } = require('../support/deliver-reminders.cjs');
const catalog = require('../../src/theme/catalog.json');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(1);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1450, height: 1100 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    const responseFor = (method, pathname) => page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === pathname);
    const widget = page.locator('.tasks-widget');
    const choice = widget.getByLabel('Thời gian nhắc nhở', { exact: true });
    assert.ok(await choice.isEnabled());
    assert.ok(await choice.locator('option[value="30"]').evaluate(el => el.disabled));
    await widget.getByLabel('Tên việc mới', { exact: true }).fill('Undated reminder QA');
    await choice.selectOption('custom');
    await widget.getByLabel('Ngày nhắc hạn', { exact: true }).fill('01/01/2099');
    await widget.getByLabel('Giờ nhắc hạn', { exact: true }).fill('09:00');
    let saved = responseFor('POST', '/api/tasks');
    await widget.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
    const taskResponse = await saved;
    assert.equal(taskResponse.status(), 201, await taskResponse.text());
    const task = await taskResponse.json();
    assert.equal(task.due_date, null); assert.ok(task.reminder_at);
    assert.equal(await choice.inputValue(), 'none');
    await widget.getByRole('button', { name: 'Sửa Undated reminder QA', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true });
    assert.equal(await dialog.getByLabel('Thời gian nhắc nhở', { exact: true }).inputValue(), 'custom');
    const edits = [];
    page.on('request', r => { if (['PATCH', 'PUT'].includes(r.method()) && /\/api\/(notes|tasks|calendar\/events)\//.test(r.url())) edits.push(r.url()); });
    await dialog.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); assert.equal(edits.length, 0);

    await page.locator('.notes-widget').getByRole('button', { name: 'Thêm', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await dialog.getByPlaceholder('Tiêu đề ghi chú...', { exact: true }).fill('Unscheduled reminder QA');
    await dialog.getByLabel('Thời gian nhắc nhở', { exact: true }).selectOption('custom');
    await dialog.getByLabel('Ngày nhắc hạn', { exact: true }).fill('01/01/2099');
    await dialog.getByLabel('Giờ nhắc hạn', { exact: true }).fill('10:00');
    await dialog.getByRole('button', { name: 'Gắn vào lịch', exact: true }).click();
    // The same light surfaces must work on all six paper colors in every theme.
    for (const theme of Object.keys(catalog.themes)) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const color of ['Vàng', 'Xanh Lá', 'Xanh Biển', 'Hồng', 'Tím', 'Trắng']) {
        await dialog.getByTitle(color, { exact: true }).click();
        const result = await dialog.getByRole('button', { name: 'Bỏ chọn lịch', exact: true }).evaluate(button => {
          const style = getComputedStyle(button);
          const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
          const luminance = values => values.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
          const ink = luminance(rgb(style.color)), background = luminance(rgb(style.backgroundColor));
          return { background: style.backgroundColor, ratio: (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05) };
        });
        assert.ok(!result.background.includes('rgba') && result.ratio >= 4.5, `${theme}/${color}: ${JSON.stringify(result)}`);
      }
    }
    await dialog.getByRole('button', { name: 'Bỏ chọn lịch', exact: true }).click();
    assert.equal(await dialog.getByLabel('Thời gian nhắc nhở', { exact: true }).inputValue(), 'custom');
    saved = responseFor('POST', '/api/notes');
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    const noteResponse = await saved;
    assert.equal(noteResponse.status(), 201, await noteResponse.text());
    const note = await noteResponse.json();
    assert.equal(note.calendar_schedule, null); assert.ok(note.reminder_at);
    await dialog.waitFor({ state: 'hidden' });
    deliverReminders(fixture.accounts[0]);
    await page.getByRole('button', { name: 'Thông báo, 2 chưa đọc', exact: true }).click();
    await page.getByRole('button', { name: 'Nhắc ghi chú: Unscheduled reminder QA', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    assert.equal(await dialog.getByLabel('Thời gian nhắc nhở', { exact: true }).inputValue(), 'custom');
    assert.equal(await dialog.getByRole('button', { name: 'Dời lịch', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); assert.equal(edits.length, 0);
    console.log('PASS: undated Task and unscheduled Note reminders, no-op saves, notification destination, and clear-schedule contrast across 9 themes × 6 paper colors.');
  } finally {
    if (browser) await browser.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
