/* Two-session QA against Docker. Only this script's marked tasks are deleted. */
const { chromium } = require('./.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://localhost:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' });
  const second = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Tokyo' });
  const a = await first.newPage(), b = await second.newPage();
  const ids = [], errors = [];
  a.on('pageerror', e => errors.push(e.message)); b.on('pageerror', e => errors.push(e.message));
  let token;
  const marker = `[Banner QA ${Date.now()}]`;
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const day = offset => new Date(Date.parse(today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  async function login(page) {
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.tasks-widget').waitFor();
  }
  async function create(title, date, time = null) {
    const response = await first.request.post(base + '/api/tasks', { headers: { Authorization: `Bearer ${token}` }, data: { title: marker + ' ' + title, due_date: date, due_time: time, priority: 'MEDIUM' } });
    assert.equal(response.status(), 201); const task = await response.json(); ids.push(task.id); return task;
  }
  const notice = (page, task) => page.locator(`[data-reminder-id="${task.id}"]`);
  const expand = async page => { const button = page.locator('.task-reminders-more').filter({ hasText: /^\+/ }); if (await button.isVisible()) await button.click(); };
  try {
    await login(a); await login(b); token = await a.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const currentMinute = new Date(Date.now() + 7 * 3600000).getUTCHours() * 60 + new Date(Date.now() + 7 * 3600000).getUTCMinutes();
    assert.ok(currentMinute >= 480 && currentMinute < 1320, 'Run in Vietnam daytime (08:00–22:00) for active reminders');
    const time = offset => { const minute = currentMinute + offset; return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; };
    const early = await create('Hạn gần', today, time(30));
    await create('Hạn tiếp theo', today, time(60));
    await create('Hạn cuối ngày', today);
    await create('Việc hôm nay khác', today, time(90));
    const tomorrow = await create('Ngày mai', day(1), '09:00');
    const overdue = await create('Đã trễ', day(-2));
    await a.locator('.task-reminders-more').waitFor();
    assert.ok(await a.locator('.task-reminders .task-reminder').count() <= 3, 'One overdue summary plus up to three individual chips');
    assert.equal(await a.locator('.task-reminder-overdue').count(), 1);
    assert.equal(await notice(a, overdue).count(), 0, 'Overdue task is summarized, not duplicated');
    await expand(a); await expand(b);
    await notice(a, early).waitFor(); await notice(b, early).waitFor();
    await notice(a, tomorrow).waitFor();
    assert.ok((await notice(a, early).innerText()).includes('Hôm nay ' + early.due_time));
    assert.ok((await notice(a, tomorrow).innerText()).includes('Ngày mai 09:00'));
    assert.ok((await notice(a, tomorrow).getAttribute('class')).includes('is-tomorrow'));
    const sortOrder = await a.locator('.task-reminder').evaluateAll(elements => elements.map(el => el.classList.contains('is-today')));
    assert.ok(!sortOrder.slice(sortOrder.indexOf(false)).includes(true), 'Today precedes tomorrow');
    await a.getByRole('button', { name: 'Nhắc lại sau 1 giờ: ' + early.title, exact: true }).click();
    await notice(a, early).waitFor({ state: 'hidden' }); await notice(b, early).waitFor({ state: 'hidden', timeout: 5000 });
    const stored = await first.request.get(base + '/api/tasks/reminders', { headers: { Authorization: `Bearer ${token}` } });
    assert.ok(!(await stored.json()).some(r => r.task_id === early.id));
    await a.getByRole('button', { name: 'Ẩn nhắc này: ' + tomorrow.title, exact: true }).click();
    await notice(b, tomorrow).waitFor({ state: 'hidden', timeout: 5000 });
    const taskResponse = await first.request.get(base + '/api/tasks', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await taskResponse.json()).find(t => t.id === tomorrow.id).is_completed, false, 'Hiding never completes a task');
    await a.getByRole('button', { name: 'Thu gọn nhắc hạn', exact: true }).click();
    assert.equal(await a.locator('.task-reminders-list').isVisible(), false);
    await a.getByRole('button', { name: 'Mở nhắc hạn', exact: true }).click();
    assert.equal(await a.locator('.task-reminders-help').count(), 0, 'Help is hidden by default');
    await a.getByRole('button', { name: 'Quy tắc nhắc hạn', exact: true }).click();
    await a.locator('.task-reminders-help').waitFor();
    await a.locator('.task-reminders-help').click();
    assert.equal(await a.locator('.task-reminders-help').isVisible(), true, 'Clicking help text keeps it open');
    await a.getByRole('button', { name: 'Quy tắc nhắc hạn', exact: true }).click();
    assert.equal(await a.locator('.task-reminders-help').count(), 0, 'Second info click closes help');
    await a.getByRole('button', { name: 'Quy tắc nhắc hạn', exact: true }).click();
    await a.locator('.task-reminders-title').click();
    assert.equal(await a.locator('.task-reminders-help').count(), 0, 'Click outside help closes it');
    await a.getByRole('button', { name: 'Quy tắc nhắc hạn', exact: true }).click();
    await a.keyboard.press('Escape');
    assert.equal(await a.locator('.task-reminders-help').count(), 0, 'Escape closes help');
    await a.getByRole('button', { name: 'Lịch', exact: true }).click();
    await a.locator('.task-reminder-overdue').click();
    await a.locator('.tasks-widget').waitFor();
    await a.waitForFunction(() => [...document.querySelectorAll('.task-filters button')].some(el => el.textContent.startsWith('Quá hạn') && el.getAttribute('aria-pressed') === 'true'));
    assert.ok((await a.locator('.task-item').evaluateAll(items => items.every(el => el.classList.contains('is-overdue')))));
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    await a.evaluate(() => window.scrollTo(0, 0));
    await a.screenshot({ path: path.join(__dirname, 'artifacts/task-reminder-banner-desktop.png'), fullPage: true });
    await a.getByRole('button', { name: 'Toggle dark/light theme' }).click();
    await a.screenshot({ path: path.join(__dirname, 'artifacts/task-reminder-banner-dark.png'), fullPage: true });
    await a.getByRole('button', { name: 'Toggle dark/light theme' }).click();
    await a.setViewportSize({ width: 390, height: 844 });
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No mobile overflow');
    await a.screenshot({ path: path.join(__dirname, 'artifacts/task-reminder-banner-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: summary, overdue link/filter from Calendar, ordered two-line chips, max four/expand/collapse, snooze/dismiss realtime in two sessions, dark mode/mobile.');
  } catch (error) {
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    await a.screenshot({ path: path.join(__dirname, 'artifacts/task-reminder-banner-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (token) for (const id of ids) await first.request.delete(base + '/api/tasks/' + id, { headers: { Authorization: `Bearer ${token}` } });
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
