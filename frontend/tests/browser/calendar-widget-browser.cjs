// Widget QA against Docker; cleanup touches only records created by this script.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://localhost:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' });
  const page = await context.newPage();
  const taskIds = [], eventIds = [], errors = [];
  let token;
  const marker = `[Widget QA ${Date.now()}]`;
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const day = offset => new Date(Date.parse(today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  page.on('pageerror', error => errors.push(error.message));
  const request = async (method, route, data) => {
    const result = await context.request[method](base + '/api/' + route, { headers: { Authorization: `Bearer ${token}` }, data });
    assert.ok(result.ok(), `${method} ${route}: ${result.status()}`);
    return result.status() === 204 ? null : result.json();
  };
  const createTask = async (title, priority, due_time = null) => {
    const task = await request('post', 'tasks', { title: marker + title, priority, due_date: today, due_time });
    taskIds.push(task.id); return task;
  };
  const createEvent = async (title, start, end, allDay) => {
    const event = await request('post', 'calendar/events', { title: marker + title, starts_at: start, ends_at: end, is_all_day: allDay, color: '#2563EB' });
    eventIds.push(event.id); return event;
  };
  try {
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    const widget = page.locator('.calendar-widget'); await widget.waitFor();
    assert.equal(await page.locator('.col-notes .calendar-widget').count(), 1);
    const notesBox = await page.locator('.col-notes > .widget-box').first().boundingBox();
    const calendarBox = await widget.boundingBox();
    assert.ok(calendarBox.y > notesBox.y + notesBox.height, 'Calendar has spacing below Notes');
    token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const overdue = await createTask('Đã trễ', 'URGENT', '00:00');
    const due = [];
    for (const priority of ['URGENT', 'HIGH', 'MEDIUM', 'LOW']) due.push(await createTask(priority, priority));
    const completed = await createTask('Đã hoàn thành', 'MEDIUM');
    await widget.locator(`[data-deadline-id="${completed.id}"]`).waitFor();
    await request('patch', 'tasks/' + completed.id, { is_completed: true });
    const allDay = await createEvent('Cả ngày', today + 'T00:00:00+07:00', day(1) + 'T00:00:00+07:00', true);
    const timed = await createEvent('Theo giờ', today + 'T10:00:00+07:00', today + 'T11:00:00+07:00', false);
    await widget.locator(`[data-event-id="${timed.id}"]`).waitFor();
    await widget.locator(`[data-deadline-id="${completed.id}"].is-completed`).waitFor();
    assert.equal(await widget.locator(`[data-deadline-id="${overdue.id}"]`).count(), 1, 'Overdue deadline is never duplicated');
    assert.equal(await widget.locator(`.calendar-overdue-group [data-deadline-id="${overdue.id}"]`).count(), 1);
    assert.deepEqual(await widget.locator('[data-calendar-group]').evaluateAll(groups => groups.map(g => g.dataset.calendarGroup)), ['all-day', 'timed', 'deadlines', 'completed']);
    assert.ok((await widget.locator(`[data-event-id="${allDay.id}"]`).innerText()).includes('Cả ngày'));
    const backgrounds = [];
    for (const task of due) backgrounds.push(await widget.locator(`[data-deadline-id="${task.id}"]`).evaluate(el => getComputedStyle(el).backgroundColor));
    assert.equal(new Set(backgrounds).size, 1, 'All priorities share a neutral row background');
    assert.notEqual(await widget.locator('[data-calendar-group="deadlines"] .calendar-deadline-priority-dot').first().evaluate(el => getComputedStyle(el).display), 'none');
    assert.equal(await widget.locator(`[data-date="${today}"]`).getAttribute('data-has-items'), 'true');
    assert.equal(await widget.locator(`[data-date="${today}"] .calendar-widget-day-dot`).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(220, 38, 38)');
    assert.ok(!(await page.locator('.task-reminders-heading').innerText()).includes('quá hạn'), 'Overdue count appears only in the banner chip');
    assert.equal(await widget.locator('.calendar-overdue-heading span').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(254, 226, 226)');
    assert.ok((await widget.boundingBox()).height > 420 && (await widget.boundingBox()).height <= 601, 'Widget gets more space, within 600px');
    const list = widget.locator('.calendar-widget-events');
    assert.ok(await list.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto'), 'Only list scrolls');
    await request('patch', 'tasks/' + due[0].id, { is_completed: true });
    await widget.locator(`[data-calendar-group="completed"] [data-deadline-id="${due[0].id}"]`).waitFor();
    const tomorrowEvent = await createEvent('Ngày mai', day(1) + 'T10:00:00+07:00', day(1) + 'T11:00:00+07:00', false);
    await widget.getByRole('button', { name: 'Ngày sau', exact: true }).click();
    await widget.locator(`[data-event-id="${tomorrowEvent.id}"]`).waitFor();
    assert.equal(await widget.locator(`[data-event-id="${timed.id}"]`).count(), 0, 'Weekly query shows only selected-day events');
    assert.equal(await widget.locator(`[data-date="${day(1)}"]`).getAttribute('data-has-items'), 'true');
    await request('delete', 'calendar/events/' + tomorrowEvent.id);
    await widget.locator(`[data-event-id="${tomorrowEvent.id}"]`).waitFor({ state: 'hidden' });
    // Find an actually empty future date without changing any existing records.
    const query = new URLSearchParams({ start: day(1) + 'T00:00:00+07:00', end: day(43) + 'T00:00:00+07:00' });
    const futureEvents = await request('get', 'calendar/events?' + query);
    const tasks = await request('get', 'tasks');
    const emptyOffset = Array.from({ length: 42 }, (_, i) => i + 1).find(offset => {
      const date = day(offset), start = Date.parse(date + 'T00:00:00+07:00');
      return !tasks.some(task => task.due_date === date) && !futureEvents.some(event => Date.parse(event.starts_at) < start + 86400000 && Date.parse(event.ends_at) > start);
    });
    assert.ok(emptyOffset, 'A future date is available for isolated marker QA');
    for (let offset = 1; offset < emptyOffset; offset++) await widget.getByRole('button', { name: 'Ngày sau', exact: true }).click();
    await widget.locator('.calendar-widget-empty').waitFor();
    const marker = widget.locator(`[data-date="${day(emptyOffset)}"] .calendar-widget-day-dot`);
    assert.equal(await marker.count(), 0, 'Empty days have no dot');
    const urgent = await request('post', 'tasks', { title: '[Widget marker QA]', priority: 'URGENT', due_date: day(emptyOffset) });
    taskIds.push(urgent.id);
    await widget.locator(`[data-deadline-id="${urgent.id}"]`).waitFor();
    assert.equal(await marker.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(220, 38, 38)');
    await request('patch', 'tasks/' + urgent.id, { is_completed: true });
    await widget.locator(`[data-deadline-id="${urgent.id}"].is-completed`).waitFor();
    assert.equal(await marker.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(37, 99, 235)', 'Completed urgent tasks use a normal blue dot');
    await request('delete', 'tasks/' + urgent.id);
    await marker.waitFor({ state: 'hidden' });
    await widget.getByRole('button', { name: 'Về hôm nay', exact: true }).click();
    await widget.locator(`[data-event-id="${timed.id}"]`).waitFor();
    fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
    await widget.screenshot({ path: path.join(__dirname, '../artifacts/calendar-widget-desktop.png') });
    await page.getByRole('button', { name: 'Toggle dark/light theme' }).click();
    await widget.screenshot({ path: path.join(__dirname, '../artifacts/calendar-widget-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.calendar-widget').getBoundingClientRect().height <= 481);
    assert.ok((await widget.boundingBox()).height <= 481);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await widget.screenshot({ path: path.join(__dirname, '../artifacts/calendar-widget-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: below Notes, groups, overdue deduplication, neutral priorities, colored week dots, subdued overdue chip, unique banner count, 600px desktop/480px mobile internal scroll, realtime completion/deletion, selected-day filtering, dark/mobile.');
  } finally {
    if (token) {
      for (const id of taskIds) await context.request.delete(base + '/api/tasks/' + id, { headers: { Authorization: `Bearer ${token}` } });
      for (const id of eventIds) await context.request.delete(base + '/api/calendar/events/' + id, { headers: { Authorization: `Bearer ${token}` } });
    }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
