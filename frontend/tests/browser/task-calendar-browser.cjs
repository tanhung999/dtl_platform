/* Integration QA: two independent browser sessions, no reloads or manual refresh.
 * Run node tests/browser/task-calendar-browser.cjs against the local Docker stack.
 * Only marked QA records created by this script are removed in finally.
 */
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://localhost:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/New_York' });
  const second = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Tokyo' });
  const a = await first.newPage(), b = await second.newPage();
  const errors = [];
  a.on('pageerror', e => errors.push(e.message)); b.on('pageerror', e => errors.push(e.message));
  const ids = [], events = [];
  let token;
  const marker = `[Deadline QA ${Date.now()}]`;
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const day = offset => new Date(Date.parse(today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  async function login(page) {
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.tasks-widget').waitFor();
    await page.locator('.task-empty').filter({ hasText: 'Đang tải' }).waitFor({ state: 'hidden' });
  }
  async function api(method, url, data) {
    const response = await first.request.fetch(base + url, { method, data, headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok(), `${method} ${url}: ${response.status()}`);
    return response.status() === 204 ? null : response.json();
  }
  const todo = (page, id) => page.locator(`[data-task-id="${id}"]`);
  const deadline = (page, id) => page.locator(`[data-deadline-id="${id}"]`);
  const checked = (page, id, value, calendar = false) => page.waitForFunction(({ id, value, calendar }) => {
    const root = document.querySelector(`[data-${calendar ? 'deadline' : 'task'}-id="${id}"]`);
    return root?.querySelector('input[type="checkbox"]')?.checked === value;
  }, { id, value, calendar }, { timeout: 5000 });
  async function edit(page, id, change) {
    await todo(page, id).getByRole('button', { name: /^Sửa / }).click();
    await change(page);
    await page.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  try {
    await login(a); await login(b);
    token = await a.evaluate(() => localStorage.getItem('dtl_platform_token'));
    console.log('QA: no deadline, date/time editing and two independent realtime clients');
    await a.getByLabel('Tên việc mới').fill(marker + ' Đồng bộ');
    const created = a.waitForResponse(r => r.url().endsWith('/api/tasks') && r.request().method() === 'POST');
    await a.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
    const task = await (await created).json(); ids.push(task.id);
    await todo(a, task.id).waitFor(); await todo(b, task.id).waitFor({ timeout: 5000 });
    assert.equal(await deadline(a, task.id).count(), 0);
    await edit(a, task.id, async page => { await page.getByLabel('Ngày hạn', { exact: true }).fill(today.split('-').reverse().join('/')); await page.getByLabel('Giờ hạn (tùy chọn)', { exact: true }).fill('23:59'); });
    await deadline(a, task.id).waitFor(); await deadline(b, task.id).waitFor({ timeout: 5000 });
    assert.ok((await deadline(a, task.id).innerText()).includes('Hạn 23:59'));
    await deadline(b, task.id).getByRole('checkbox').click();
    await todo(a, task.id).getByRole('checkbox').waitFor();
    await checked(a, task.id, true);
    assert.ok((await deadline(a, task.id).getAttribute('class')).includes('is-completed'));
    await todo(a, task.id).getByRole('checkbox').click();
    await checked(b, task.id, false, true);
    await edit(a, task.id, async page => { await page.getByLabel('Ngày hạn', { exact: true }).fill(day(1).split('-').reverse().join('/')); });
    await deadline(b, task.id).waitFor({ state: 'hidden', timeout: 5000 });
    await edit(a, task.id, async page => { await page.getByRole('button', { name: 'Xóa hạn', exact: true }).click(); });
    await todo(b, task.id).getByText('Không hạn', { exact: true }).waitFor({ timeout: 5000 });
    await edit(a, task.id, async page => { await page.getByLabel('Ngày hạn', { exact: true }).fill(today.split('-').reverse().join('/')); });
    console.log('QA: reconnect and recover changes made while offline');
    await second.setOffline(true);
    await api('PATCH', '/api/tasks/' + task.id, { title: marker + ' Sau kết nối lại' });
    await second.setOffline(false);
    await todo(b, task.id).getByText(marker + ' Sau kết nối lại', { exact: true }).waitFor({ timeout: 20000 });
    console.log('QA: overdue group, reminder receipts and all calendar views');
    const overdue = await api('POST', '/api/tasks', { title: marker + ' Quá hạn', due_date: day(-1), priority: 'URGENT' }); ids.push(overdue.id);
    await b.locator('.calendar-overdue-group').locator(`[data-deadline-id="${overdue.id}"]`).waitFor({ timeout: 5000 });
    await b.locator('.task-overdue-badge').waitFor();
    const reminder = await api('POST', '/api/tasks', { title: marker + ' Nhắc hạn', due_date: today, priority: 'HIGH' }); ids.push(reminder.id);
    const dismissName = 'Ẩn nhắc này: ' + reminder.title;
    for (const page of [a, b]) {
      const more = page.locator('.task-reminders-more').filter({ hasText: /^\+/ });
      if (await more.isVisible()) await more.click();
    }
    await a.getByRole('button', { name: dismissName, exact: true }).waitFor({ timeout: 5000 });
    await a.getByRole('button', { name: dismissName, exact: true }).click();
    await b.getByRole('button', { name: dismissName, exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
    const notices = await api('GET', '/api/tasks/reminders');
    assert.ok(!notices.some(r => r.task_id === reminder.id));
    await a.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    await a.locator('.calendar-week').waitFor();
    await a.locator('.calendar-week').locator(`[data-deadline-id="${task.id}"]`).waitFor();
    await a.getByRole('button', { name: 'Tháng', exact: true }).click();
    await a.locator('.calendar-month').waitFor();
    const monthTask = a.locator('.calendar-month').locator(`[data-deadline-id="${task.id}"]`);
    if (await monthTask.count()) await monthTask.waitFor();
    else {
      // Crowded dates intentionally show only three entries; check overflow navigation.
      const dateLabel = new Date(today + 'T00:00:00Z').toLocaleDateString('vi-VN', { timeZone: 'UTC' });
      const cell = a.getByRole('button', { name: `Thêm sự kiện ngày ${dateLabel}`, exact: true }).locator('..');
      await cell.locator('.calendar-more').click();
      await a.locator('.calendar-agenda').locator(`[data-deadline-id="${task.id}"]`).waitFor();
    }
    await a.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await a.locator('.calendar-agenda').locator(`[data-deadline-id="${task.id}"]`).waitFor();
    const event = await api('POST', '/api/calendar/events', { title: marker + ' Sự kiện riêng', starts_at: today + 'T10:00:00+07:00', ends_at: today + 'T11:00:00+07:00', is_all_day: false, color: '#2563eb' }); events.push(event.id);
    await a.locator('.calendar-agenda-event').filter({ hasText: event.title }).waitFor({ timeout: 5000 });
    await b.locator('.calendar-widget-event').filter({ hasText: event.title }).waitFor({ timeout: 5000 });
    await api('PUT', '/api/calendar/events/' + event.id, { ...event, id: undefined, user_id: undefined, created_at: undefined, updated_at: undefined, title: event.title + ' sửa' });
    await a.locator('.calendar-agenda-event').filter({ hasText: event.title + ' sửa' }).waitFor({ timeout: 5000 });
    await api('DELETE', '/api/calendar/events/' + event.id);
    await b.locator('.calendar-widget-event').filter({ hasText: event.title }).waitFor({ state: 'hidden', timeout: 5000 });
    fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
    await a.screenshot({ path: path.join(__dirname, '../artifacts/task-calendar-desktop.png'), fullPage: true });
    await b.setViewportSize({ width: 390, height: 844 });
    assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile width fits');
    await b.screenshot({ path: path.join(__dirname, '../artifacts/task-calendar-mobile.png'), fullPage: true });
    b.once('dialog', dialog => dialog.accept());
    await todo(b, task.id).getByRole('button', { name: /^Xóa / }).click();
    await a.locator(`[data-deadline-id="${task.id}"]`).waitFor({ state: 'hidden', timeout: 5000 });
    await todo(b, task.id).waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('PASS: bidirectional task/calendar sync, deadlines, overdue, reminders, independent event CRUD, reconnect and cross-client realtime without reload.');
  } catch (error) {
    fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
    await a.screenshot({ path: path.join(__dirname, '../artifacts/task-calendar-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (token) {
      for (const id of ids) await first.request.delete(base + '/api/tasks/' + id, { headers: { Authorization: `Bearer ${token}` } });
      for (const id of events) await first.request.delete(base + '/api/calendar/events/' + id, { headers: { Authorization: `Bearer ${token}` } });
    }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
