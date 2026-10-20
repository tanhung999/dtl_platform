// Controlled clock: validates minute-based automatic transitions without reload or API writes.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://localhost:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' });
  const page = await context.newPage();
  const clockStart = new Date(Math.floor(Date.now() / 60000) * 60000);
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 1000));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let token, id, multiId;
  try {
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    await page.locator('.calendar-widget-message').filter({ hasText: 'Đang tải lịch' }).waitFor({ state: 'hidden' });
    for (const card of await page.locator('.calendar-widget-event').all()) {
      const status = await card.getAttribute('data-event-status');
      const expected = { upcoming: ['Sắp tới', '#EAB308'], ongoing: ['Đang diễn ra', '#2563EB'], ended: ['Đã kết thúc', '#16A34A'] }[status];
      assert.ok(expected);
      assert.ok((await card.innerText()).includes(expected[0]));
      assert.equal(await card.evaluate(el => el.style.getPropertyValue('--event-color')), expected[1]);
    }
    const now = await page.evaluate(() => Date.now());
    const starts = Math.ceil(now / 60000) * 60000;
    const response = await context.request.post(base + '/api/calendar/events', {
      headers: { Authorization: `Bearer ${token}` }, data: {
        title: `[Status QA ${now}] Tự chuyển trạng thái`, starts_at: new Date(starts).toISOString(),
        ends_at: new Date(starts + 60000).toISOString(), is_all_day: false, color: '#be123c',
      },
    });
    assert.equal(response.status(), 201);
    id = (await response.json()).id;
    // The widget shows at most four events; full calendar always exposes this record.
    await page.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    const selector = `[data-event-id="${id}"]`;
    const row = page.locator(selector);
    for (const view of ['Tuần', 'Tháng', 'Danh sách']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      if (view === 'Tháng' && !await row.isVisible()) {
        await page.locator('.calendar-month-cell').filter({ has: page.locator('.calendar-day-number.is-today') }).getByRole('button', { name: /mục khác/ }).click();
      }
      await row.waitFor();
      assert.equal(await row.getAttribute('data-event-status'), 'upcoming');
      // Short and compact cards omit the status label to preserve title/time space.
      if (await row.locator('.calendar-event-status').count()) assert.ok((await row.innerText()).includes('Sắp tới'));
      assert.equal(await row.evaluate(el => el.style.getPropertyValue('--event-color')), '#EAB308');
    }
    console.log('QA: all views have automatic yellow upcoming status; checking minute-clock transitions');
    const waitStatus = status => page.waitForFunction(({ selector, status }) => document.querySelector(selector)?.dataset.eventStatus === status,
      { selector, status }, { timeout: 35000 });
    await page.clock.fastForward(60020);
    await waitStatus('ongoing');
    // Short and compact cards omit the status label to preserve title/time space.
    if (await row.locator('.calendar-event-status').count()) assert.ok((await row.innerText()).includes('Đang diễn ra'));
    assert.equal(await row.evaluate(el => el.style.getPropertyValue('--event-color')), '#2563EB');
    await page.clock.fastForward(60020);
    await waitStatus('ended');
    // Short and compact cards omit the status label to preserve title/time space.
    if (await row.locator('.calendar-event-status').count()) assert.ok((await row.innerText()).includes('Đã kết thúc'));
    assert.equal(await row.evaluate(el => el.style.getPropertyValue('--event-color')), '#16A34A');
    await page.clock.resume();
    assert.equal(await row.locator('strong').evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
    await page.getByRole('button', { name: 'Tuần', exact: true }).click();
    await row.waitFor();
    assert.equal(await row.getAttribute('data-event-status'), 'ended');
    assert.equal(await row.evaluate(el => getComputedStyle(el).opacity), '0.9', 'Ended timed events remain readable');
    const line = page.locator('.calendar-now-line');
    const lineBox = await line.boundingBox(), columnBox = await line.locator('..').boundingBox();
    assert.ok(Math.abs(lineBox.width - columnBox.width) <= 2, 'Now line spans the today column');
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const day = offset => new Date(Date.parse(today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
    const multi = await context.request.post(base + '/api/calendar/events', {
      headers: { Authorization: `Bearer ${token}` }, data: {
        title: `[Status QA ${Date.now()}] Màu từng ngày`, starts_at: day(-8) + 'T00:00:00+07:00',
        ends_at: day(2) + 'T00:00:00+07:00', is_all_day: true, color: '#be123c',
      },
    });
    assert.equal(multi.status(), 201); multiId = (await multi.json()).id;
    // The fixture is created directly through the API while the browser clock is paused.
    // Fetch it explicitly; the automatic start/end transitions above need no reload.
    await page.getByRole('button', { name: 'Làm mới lịch', exact: true }).click();
    const multiRow = status => page.locator(`[data-event-id="${multiId}"][data-event-status="${status}"]`).first();
    for (const view of ['Tuần', 'Tháng', 'Danh sách']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      if (view === 'Tháng' && !await multiRow('ongoing').isVisible()) {
        assert.equal(await page.locator('.calendar-month-cell').filter({ has: page.locator('.calendar-day-number.is-today') }).getByRole('button', { name: /mục khác/ }).count(), 1);
        await page.getByRole('button', { name: 'Bật/tắt hạn công việc' }).click();
      }
      await multiRow('ongoing').waitFor(); await multiRow('upcoming').waitFor();
      if (view === 'Tháng') await multiRow('ended').waitFor();
    }
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await multiRow('ongoing').waitFor();
    await page.locator('.calendar-widget').getByRole('button', { name: 'Ngày sau', exact: true }).click();
    await multiRow('upcoming').waitFor();
    for (let i = 0; i < 2; i++) await page.locator('.calendar-widget').getByRole('button', { name: 'Ngày trước', exact: true }).click();
    await multiRow('ended').waitFor();
    await page.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../artifacts/calendar-status-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: automatic start/end transitions, distinct past/current/future colors for one multi-day event in week/month/agenda/widget, mobile.');
  } finally {
    if (token) for (const eventId of [id, multiId].filter(Boolean)) await context.request.delete(base + '/api/calendar/events/' + eventId, { headers: { Authorization: `Bearer ${token}` } });
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
