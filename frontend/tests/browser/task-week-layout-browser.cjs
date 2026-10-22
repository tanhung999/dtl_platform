// Week timeline QA; cleanup only records created by this script.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://localhost:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' });
  const page = await context.newPage(), taskIds = [], eventIds = [], errors = [];
  let token;
  page.on('pageerror', e => errors.push(e.message));
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const afterTomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
  const marker = `[Week deadline QA ${Date.now()}]`;
  const api = async (method, route, data) => {
    const response = await context.request.fetch(base + '/api/' + route, { method, data, headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok(), `${method} ${route}: ${response.status()}`);
    return response.status() === 204 ? null : response.json();
  };
  try {
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    await page.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    const week = page.locator('.calendar-week'); await week.waitFor();
    assert.ok((await page.locator('.calendar-page-heading').boundingBox()).y >= (await page.locator('.platform-navbar').boundingBox()).height, 'Calendar heading clears the sticky navbar');
    assert.equal(await page.locator('.calendar-toolbar').getByRole('checkbox', { name: 'Hiện khung giờ đêm' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Hôm nay', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Làm mới lịch', exact: true }).getAttribute('title'), 'Tải lại');
    assert.equal(await page.locator('.calendar-mini-grid .is-viewed-week').count(), 7);
    assert.ok(await page.locator('.calendar-week-scroll').evaluate(el => Math.abs(el.scrollTop - 120) <= 1), 'Initial scroll shows 08:00, with early hours hidden');
    await page.locator('.calendar-mini-grid').getByRole('button', { name: new Date(tomorrow + 'T00:00:00Z').toLocaleDateString('vi-VN', { dateStyle: 'full', timeZone: 'UTC' }), exact: true }).click();
    await page.getByRole('checkbox', { name: 'Hiện khung giờ đêm' }).check();
    const overdue = await api('POST', 'tasks', { title: marker + ' quá hạn', due_date: today, due_time: '00:00', priority: 'URGENT' }); taskIds.push(overdue.id);
    await page.locator(`.calendar-overdue-compact [data-deadline-id="${overdue.id}"]`).waitFor();
    assert.equal(await week.locator(`[data-deadline-id="${overdue.id}"]`).count(), 0, 'Overdue only appears in banner');
    assert.ok((await page.locator(`.calendar-overdue-compact [data-deadline-id="${overdue.id}"]`).innerText()).includes('00:00 hôm nay'));
    const tasks = [];
    for (const time of [null, '00:00', '10:00', '10:10', '23:59']) {
      const task = await api('POST', 'tasks', { title: `${marker} ${time || 'Cả ngày'}`, due_date: tomorrow, due_time: time, priority: 'MEDIUM' });
      taskIds.push(task.id); tasks.push(task);
      await week.locator(`[data-deadline-id="${task.id}"]`).waitFor();
      assert.equal(await week.locator(`.calendar-all-day-cell [data-deadline-id="${task.id}"]`).count(), time ? 0 : 1);
      assert.equal(await week.locator(`.calendar-time-column [data-deadline-id="${task.id}"]`).count(), time ? 1 : 0);
      if (time) {
        const [hour, minute] = time.split(':').map(Number);
        assert.equal(await week.locator(`[data-deadline-id="${task.id}"]`).locator('..').evaluate(el => parseFloat(el.style.top)), hour * 60 + minute);
        assert.equal(await week.locator(`[data-deadline-id="${task.id}"]`).locator('..').evaluate(el => parseFloat(el.style.height)), 24, 'Deadline is a 24px marker');
      }
      assert.equal(await week.locator(`[data-deadline-id="${task.id}"] .calendar-deadline-priority-dot`).isVisible(), true);
      assert.ok((await week.locator(`[data-deadline-id="${task.id}"] button`).getAttribute('data-tooltip')).includes(task.title));
    }
    for (const allDay of [true, false]) {
      const event = await api('POST', 'calendar/events', { title: `${marker} event ${allDay}`, starts_at: tomorrow + (allDay ? 'T00:00:00+07:00' : 'T10:00:00+07:00'), ends_at: (allDay ? afterTomorrow + 'T00:00:00+07:00' : tomorrow + 'T11:00:00+07:00'), is_all_day: allDay, color: '#2563EB' });
      eventIds.push(event.id); await week.locator(`[data-event-id="${event.id}"]`).waitFor();
      assert.equal(await week.locator(`${allDay ? '.calendar-week-all-day' : '.calendar-time-column'} [data-event-id="${event.id}"]`).count(), 1);
      if (allDay) assert.ok((await week.locator(`[data-event-id="${event.id}"] .calendar-event-title`).boundingBox()).height >= 10, 'All-day titles stay visible');
    }
    assert.equal(await page.locator(`.calendar-mini-grid [data-date="${tomorrow}"] .calendar-mini-day-dot`).count(), 1);
    const late = week.locator(`[data-deadline-id="${tasks[4].id}"]`);
    await late.scrollIntoViewIfNeeded();
    const lateRect = await late.boundingBox(), columnRect = await late.locator('../..').boundingBox();
    assert.ok(lateRect.y + lateRect.height <= columnRect.y + columnRect.height + 1, '23:59 deadline is fully visible');
    await week.locator(`[data-deadline-id="${tasks[2].id}"]`).getByRole('checkbox').click();
    await week.locator(`[data-deadline-id="${tasks[2].id}"].is-completed`).waitFor();
    assert.equal(await week.locator(`[data-deadline-id="${tasks[2].id}"] .calendar-deadline-title`).evaluate(el => getComputedStyle(el).textDecorationLine), 'line-through');
    await api('PATCH', 'tasks/' + tasks[3].id, { due_time: '11:30' });
    await page.waitForFunction(id => document.querySelector(`.calendar-week [data-deadline-id="${id}"]`)?.parentElement.style.top === '690px', tasks[3].id);
    await api('PATCH', 'tasks/' + tasks[3].id, { due_time: null });
    await week.locator(`.calendar-all-day-cell [data-deadline-id="${tasks[3].id}"]`).waitFor();
    assert.equal(await week.locator(`.calendar-time-column [data-deadline-id="${tasks[3].id}"]`).count(), 0);
    await api('PATCH', 'tasks/' + tasks[3].id, { due_time: '10:10' });
    await week.locator(`.calendar-time-column [data-deadline-id="${tasks[3].id}"]`).waitFor();
    await week.locator(`[data-deadline-id="${tasks[3].id}"]`).scrollIntoViewIfNeeded();
    const narrowEvent = week.locator(`.calendar-time-column [data-event-id="${eventIds[1]}"]`);
    assert.equal(await narrowEvent.locator('.calendar-event-status').count(), 0, 'Narrow events show title and time');
    await narrowEvent.click();
    await page.getByRole('dialog').locator('.calendar-event-status').first().waitFor();
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Hiện công việc', exact: true }).uncheck();
    assert.equal(await page.locator('.calendar-main [data-deadline-id]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Bật/tắt công việc' }).getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: 'Bật/tắt công việc' }).click();
    await week.locator(`[data-deadline-id="${tasks[3].id}"]`).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Hiện công việc', exact: true }).isChecked(), true);
    const mondayDate = new Date(today + 'T00:00:00Z');
    mondayDate.setUTCDate(mondayDate.getUTCDate() - (mondayDate.getUTCDay() + 6) % 7);
    const monday = mondayDate.toISOString().slice(0, 10);
    const weekEnd = new Date(mondayDate.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const spanning = await api('POST', 'calendar/events', { title: marker + ' một thanh nhiều ngày', starts_at: monday + 'T00:00:00+07:00', ends_at: weekEnd + 'T00:00:00+07:00', is_all_day: true, color: '#2563EB' }); eventIds.push(spanning.id);
    const spanBar = week.locator(`button.calendar-all-day-span[data-event-id="${spanning.id}"]`);
    await spanBar.waitFor();
    assert.equal(await spanBar.count(), 1, 'One multi-day event renders as one continuous bar');
    assert.ok((await spanBar.boundingBox()).width > (await week.locator('.calendar-time-column').first().boundingBox()).width * 6);
    assert.equal(await spanBar.locator('.calendar-all-day-segments > span').count(), 7);
    assert.equal(await spanBar.evaluate(el => getComputedStyle(el).borderRadius), '6px');
    assert.equal(await week.locator('.calendar-week-all-day').evaluate(el => getComputedStyle(el).rowGap), '4px');
    assert.ok(await page.locator('.calendar-all-day-cell').evaluateAll(cells => cells.every(cell => getComputedStyle(cell).overflowY !== 'auto')), 'All-day has no nested scrolling');
    assert.equal(await week.locator('.calendar-now-line').count(), await week.locator(`[data-date="${today}"].calendar-time-column`).count() ? 1 : 0);
    for (let i = 0; i < 5; i++) { const task = await api('POST', 'tasks', { title: marker + ' overflow ' + i, due_date: tomorrow }); taskIds.push(task.id); }
    await week.locator('.calendar-all-day-footer .calendar-more').first().waitFor();
    assert.ok((await week.locator('.calendar-week-all-day').boundingBox()).height <= 172, 'All-day stops at four rows plus overflow and spacing');
    await page.getByRole('checkbox', { name: 'Hiện khung giờ đêm' }).uncheck();
    await week.locator(`[data-deadline-id="${tasks[3].id}"]`).scrollIntoViewIfNeeded();
    fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../artifacts/task-week-layout.png'), fullPage: true });
    for (const view of ['Tháng', 'Danh sách']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      assert.equal(await page.locator(`.calendar-main [data-deadline-id="${overdue.id}"]`).count(), 1, 'Overdue only appears in banner in every view');
      await page.getByRole('button', { name: 'Bật/tắt công việc' }).click();
      assert.equal(await page.locator('.calendar-main [data-deadline-id]').count(), 0);
      await page.getByRole('button', { name: 'Bật/tắt công việc' }).click();
    }
    await page.getByRole('button', { name: 'Toggle dark/light theme' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(__dirname, '../artifacts/task-calendar-controls-mobile-dark.png'), fullPage: true });
    const age = page.locator(`.calendar-overdue-task[data-deadline-id="${overdue.id}"] .calendar-overdue-age`);
    const originalAge = await age.innerText();
    await page.clock.install();
    await page.clock.fastForward(3600000);
    await page.waitForFunction(({ id, before }) => document.querySelector(`.calendar-overdue-task[data-deadline-id="${id}"] .calendar-overdue-age`)?.textContent !== before, { id: overdue.id, before: originalAge });
    assert.notEqual(await age.innerText(), originalAge, 'Overdue age advances without reload or API writes');
    assert.deepEqual(errors, []);
    console.log('PASS: overdue deduplication/relative label, 24px markers, initial 08:00/early-hours toggle, four all-day rows/overflow, task visibility toggle, mini-week highlight, toolbar, midnight/23:59, realtime time changes.');
  } finally {
    if (token) {
      for (const id of taskIds) await context.request.delete(base + '/api/tasks/' + id, { headers: { Authorization: `Bearer ${token}` } });
      for (const id of eventIds) await context.request.delete(base + '/api/calendar/events/' + id, { headers: { Authorization: `Bearer ${token}` } });
    }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
