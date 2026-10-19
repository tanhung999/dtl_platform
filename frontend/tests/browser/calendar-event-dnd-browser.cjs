const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createDragUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
async function main() {
  const fixture = createDragUsers(1), browser = await chromium.launch({ channel: 'msedge', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 1400 } }), second = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const a = await first.newPage(), b = await second.newPage(), errors = [], base = 'http://127.0.0.1:5173';
  let token, rangeStart, rangeEnd;
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  const api = async (method, route, data) => { const response = await first.request.fetch(base + '/api/' + route, { method, data, headers: { Authorization: `Bearer ${token}` } }); assert.ok(response.ok(), `${route}: ${response.status()} ${await response.text()}`); return response.status() === 204 ? null : response.json(); };
  const login = async page => { await page.goto(base); await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username); await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password); await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click(); await page.locator('.calendar-widget').waitFor(); };
  const eventButton = (page, event) => page.locator(`button[data-event-id="${event.id}"]`);
  const allDay = date => a.locator(`[data-drop-type="calendar-all-day"][data-drop-date="${date}"]`);
  const slot = (date, time) => a.locator(`.calendar-time-slot[data-drop-date="${date}"][data-drop-time="${time}"]`);
  const drag = async (source, target, fraction = .25) => {
    const resizing = await source.evaluate(node => node.hasAttribute('data-event-resize') && !!node.closest('.calendar-event-drag-frame'));
    await source.scrollIntoViewIfNeeded(); const s = await source.boundingBox();
    await a.mouse.move(s.x + Math.min(12, s.width / 2), s.y + s.height / 2); await a.mouse.down();
    await a.mouse.move(s.x + Math.min(12, s.width / 2) + 12, s.y + s.height / 2, { steps: 3 });
    await a.locator(resizing ? '.calendar-resize-ghost' : '.calendar-event-drag-preview').waitFor();
    await target.scrollIntoViewIfNeeded(); const t = await target.boundingBox();
    await a.mouse.move(t.x + t.width / 2, t.y + t.height * fraction, { steps: 20 });
    if (resizing) await a.locator('.calendar-resize-ghost').waitFor(); else await target.locator('.calendar-deadline-drop-caption').waitFor();
    await a.mouse.up();
    await a.locator('.calendar-event-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    await a.locator('.calendar-event-toast').hover();
    assert.equal(await a.getByRole('dialog').count(), 0);
  };
  const latest = async event => (await api('GET', `calendar/events?start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}`)).find(item => item.id === event.id);
  const check = async (event, start, end) => { const current = await latest(event); assert.equal(Date.parse(current.starts_at), Date.parse(start)); assert.equal(Date.parse(current.ends_at), Date.parse(end)); await b.waitForFunction(({ id, time }) => document.querySelector(`button[data-event-id="${id}"] .calendar-event-time`)?.textContent.includes(time), { id: event.id, time: start.slice(11, 16) }); return current; };
  try {
    await login(a); await login(b); token = await a.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const dates = await a.locator('.calendar-widget-week button').evaluateAll(nodes => nodes.map(node => node.dataset.date));
    rangeStart = dates[0] + 'T00:00:00+07:00'; rangeEnd = new Date(Date.parse(dates[6] + 'T00:00:00Z') + 8 * 86400000).toISOString();
    for (const page of [a, b]) await page.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    const timed = await api('POST', 'calendar/events', { title: 'QA Event move/resize', starts_at: dates[2] + 'T10:00:00+07:00', ends_at: dates[2] + 'T11:00:00+07:00', is_all_day: false });
    await eventButton(a, timed).waitFor();
    await drag(eventButton(a, timed), slot(dates[3], '10:00'), .25);
    await check(timed, dates[3] + 'T10:15:00+07:00', dates[3] + 'T11:15:00+07:00');
    await drag(eventButton(a, timed).locator('..').locator('[data-event-resize="start"]'), slot(dates[3], '10:00'), .5);
    await check(timed, dates[3] + 'T10:30:00+07:00', dates[3] + 'T11:15:00+07:00');
    await drag(eventButton(a, timed).locator('..').locator('[data-event-resize="end"]'), slot(dates[3], '12:00'), .75);
    await check(timed, dates[3] + 'T10:30:00+07:00', dates[3] + 'T12:45:00+07:00');
    await a.locator('.calendar-event-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await a.getByText('Đã hoàn tác sự kiện', { exact: true }).waitFor();
    await check(timed, dates[3] + 'T10:30:00+07:00', dates[3] + 'T11:15:00+07:00');
    const multi = await api('POST', 'calendar/events', { title: 'QA Multi-day move/resize', starts_at: dates[2] + 'T00:00:00+07:00', ends_at: dates[4] + 'T00:00:00+07:00', is_all_day: true });
    await eventButton(a, multi).waitFor();
    await drag(eventButton(a, multi), allDay(dates[4]), .5);
    let current = await latest(multi); assert.equal(Date.parse(current.starts_at), Date.parse(dates[4] + 'T00:00:00+07:00')); assert.equal(Date.parse(current.ends_at), Date.parse(dates[6] + 'T00:00:00+07:00'));
    await drag(eventButton(a, multi).locator('..').locator('[data-event-resize="end"]'), allDay(dates[6]), .5);
    const nextWeek = new Date(Date.parse(dates[6] + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    current = await latest(multi); assert.equal(Date.parse(current.ends_at), Date.parse(nextWeek + 'T00:00:00+07:00'));
    await drag(eventButton(a, multi).locator('..').locator('[data-event-resize="start"]'), allDay(dates[3]), .5);
    current = await latest(multi); assert.equal(Date.parse(current.starts_at), Date.parse(dates[3] + 'T00:00:00+07:00'));
    await eventButton(b, multi).waitFor();
    assert.equal(await eventButton(b, multi).locator('.calendar-all-day-segments > span').count(), 4);
    // Undo is guarded when another client has changed the event after this drag.
    await api('PATCH', `calendar/events/${multi.id}/schedule`, { starts_at: dates[2] + 'T00:00:00+07:00', ends_at: current.ends_at, is_all_day: true, expected_updated_at: current.updated_at });
    await a.locator('.calendar-event-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await a.locator('.calendar-event-toast.is-error').waitFor();
    assert.equal(Date.parse((await latest(multi)).starts_at), Date.parse(dates[2] + 'T00:00:00+07:00'));
    await a.setViewportSize({ width: 390, height: 844 });
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log('PASS: event move at 15-minute snap, resize top/bottom, multi-day bar move and both ends, duration preservation, exclusive end, undo/stale guard, two-session realtime and mobile.');
  } finally { await browser.close(); fixture.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
