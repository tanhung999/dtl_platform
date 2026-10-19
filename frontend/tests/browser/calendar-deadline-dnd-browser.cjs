// Deadline-to-calendar QA; creates and removes only this script's marked task.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://127.0.0.1:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 1400 }, hasTouch: true });
  const second = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const a = await first.newPage(), b = await second.newPage(), errors = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  let token, task;
  const api = async (method, route, payload) => {
    if (method === 'PATCH' && route.startsWith('tasks/') && !route.includes('/reminders/') && payload.expected_version === undefined) {
      const current = await first.request.get(base + '/api/' + route, { headers: { Authorization: `Bearer ${token}` } });
      payload = { ...payload, expected_version: (await current.json()).version };
    }
    const response = await first.request.fetch(base + '/api/' + route, { method, data: payload, headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`);
    return response.status() === 204 ? null : response.json();
  };
  const login = async page => {
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget-week button').last().waitFor();
  };
  const deadline = (page, scope) => page.locator(`${scope} [data-deadline-id="${task.id}"]`);
  const allDay = date => a.locator(`.calendar-week-all-day [data-drop-date="${date}"][data-drop-type="calendar-all-day"]`);
  const slot = (date, time) => a.locator(`.calendar-time-slot[data-drop-date="${date}"][data-drop-time="${time}"]`);
  const performDrop = async (source, target, caption) => {
    const button = source.locator('button').first();
    await button.scrollIntoViewIfNeeded();
    const sourceBox = await button.boundingBox();
    // Avoid moving to the bottom edge where dnd-kit auto-scroll would shift the drop target.
    await a.mouse.move(sourceBox.x + Math.min(25, sourceBox.width / 2), sourceBox.y + sourceBox.height / 2);
    await a.mouse.down(); await a.mouse.move(sourceBox.x + 12, sourceBox.y + 10, { steps: 3 });
    await a.locator('.task-calendar-drag-preview').waitFor();
    await target.scrollIntoViewIfNeeded();
    const targetBox = await target.boundingBox();
    await a.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + (await target.getAttribute('data-drop-time') ? 3 : targetBox.height / 2), { steps: 20 });
    const finalBox = await target.boundingBox();
    await a.mouse.move(finalBox.x + finalBox.width / 2, finalBox.y + (await target.getAttribute('data-drop-time') ? 1 : finalBox.height / 2));
    try { await target.locator(caption).waitFor({ timeout: 5000 }); }
    catch (error) {
      console.log('Drop debug', await a.evaluate(() => ({ active: [...document.querySelectorAll('.is-drop-target')].map(node => ({ date: node.dataset.dropDate, time: node.dataset.dropTime, text: node.textContent })), scroll: document.querySelector('.calendar-week-scroll')?.scrollTop })), { sourceBox, targetBox, currentTargetBox: await target.boundingBox() });
      await a.screenshot({ path: 'tests/artifacts/calendar-deadline-dnd-debug.png', fullPage: true }); throw error;
    }
    await a.mouse.up();
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    assert.equal(await a.getByRole('dialog').count(), 0, 'Dragging does not accidentally open edit/create forms');
  };
  const check = async (date, time) => {
    const latest = (await api('GET', 'tasks')).find(item => item.id === task.id);
    assert.equal(latest.due_date, date); assert.equal(latest.due_time, time);
    await b.waitForFunction(({ id, date }) => document.querySelector(`.tasks-widget [data-task-id="${id}"] .task-deadline-button`)?.textContent.includes(new Date(date + 'T00:00:00Z').toLocaleDateString('vi-VN', { timeZone: 'UTC' })), { id: task.id, date });
    await a.waitForFunction(({ id, date, time }) => {
      if (!document.querySelector('.calendar-page')) return true;
      const row = document.querySelector(`.calendar-view-content [data-deadline-id="${id}"]`);
      const label = new Date(date + 'T00:00:00Z').toLocaleDateString('vi-VN', { timeZone: 'UTC' });
      return !!row?.querySelector('button')?.title.includes(label) && (time ? row.closest('.calendar-time-column')?.getAttribute('data-date') === date && row.querySelector('.calendar-deadline-label').textContent.includes(time) : !!row.closest('.calendar-week-all-day'));
    }, { id: task.id, date, time });
    return latest;
  };
  try {
    await login(a); await login(b);
    token = await a.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const dates = await a.locator('.calendar-widget-week button').evaluateAll(buttons => buttons.map(button => button.dataset.date));
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    task = await api('POST', 'tasks', { title: `[Deadline Dnd QA ${Date.now()}] Chuyển hạn`, due_date: dates[6], due_time: '14:00', priority: 'LOW' });
    await a.locator(`.calendar-widget-week button[data-date="${dates[6]}"]`).click();
    await deadline(a, '.calendar-widget').waitFor();
    await performDrop(deadline(a, '.calendar-widget'), a.locator(`.calendar-widget-week button[data-date="${dates[4]}"]`), '.calendar-drop-label');
    await check(dates[4], '14:00');
    await a.locator(`.calendar-widget-week button[data-date="${dates[4]}"]`).click();
    await deadline(a, '.calendar-widget').waitFor();
    const touch = await first.newCDPSession(a);
    const sourceBox = await deadline(a, '.calendar-widget').locator('button').boundingBox();
    const targetBox = await a.locator(`.calendar-widget-week button[data-date="${dates[6]}"]`).boundingBox();
    const point = (x, y) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(sourceBox.x + 25, sourceBox.y + sourceBox.height / 2) });
    await a.locator('.task-calendar-drag-preview').waitFor();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2) });
    await a.locator(`.calendar-widget-week button[data-date="${dates[6]}"] .calendar-drop-label`).waitFor();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    await check(dates[6], '14:00'); await touch.detach();

    await a.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    await a.getByRole('checkbox', { name: 'Hiện sự kiện', exact: true }).uncheck();
    await a.getByRole('checkbox', { name: 'Hiện việc cần làm', exact: true }).check();
    await deadline(a, '.calendar-time-column').waitFor();
    await performDrop(deadline(a, '.calendar-time-column'), allDay(dates[4]), '.calendar-deadline-drop-caption');
    await check(dates[4], null);
    await deadline(a, '.calendar-week-all-day').waitFor();
    assert.equal(await deadline(a, '.calendar-time-column').count(), 0);

    // Same date, adding a time: must not be treated as a no-op.
    await performDrop(deadline(a, '.calendar-week-all-day'), slot(dates[4], '10:00'), '.calendar-deadline-drop-caption');
    await check(dates[4], '10:00');
    await deadline(a, '.calendar-time-column').waitFor();
    assert.equal(await deadline(a, '.calendar-time-column').locator('..').evaluate(el => parseFloat(el.style.height)), 24);
    await performDrop(deadline(a, '.calendar-time-column'), slot(dates[5], '09:00'), '.calendar-deadline-drop-caption');
    const timed = await check(dates[5], '09:00');
    await performDrop(deadline(a, '.calendar-time-column'), allDay(dates[5]), '.calendar-deadline-drop-caption');
    await check(dates[5], null);
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await a.getByText('Đã hoàn tác hạn công việc', { exact: true }).waitFor();
    const restored = await check(dates[5], '09:00');
    assert.ok(restored.deadline_version > timed.deadline_version);

    // Today's date-only deadline recalculates reminder eligibility and keeps two-way completion.
    await performDrop(deadline(a, '.calendar-time-column'), allDay(today), '.calendar-deadline-drop-caption');
    const updated = await check(today, null);
    const vnHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (vnHour >= 8) {
      const reminder = (await api('GET', 'tasks/reminders')).find(item => item.task_id === task.id);
      assert.ok(reminder); assert.equal(reminder.deadline_version, updated.deadline_version); assert.equal(reminder.kind, 'day');
    }
    await deadline(a, '.calendar-week-all-day').getByRole('checkbox').click();
    await b.locator(`.tasks-widget [data-task-id="${task.id}"].completed`).waitFor();
    await deadline(a, '.calendar-week-all-day').getByRole('checkbox').click();
    await b.waitForFunction(id => !document.querySelector(`.tasks-widget [data-task-id="${id}"]`)?.classList.contains('completed'), task.id);
    // Short click still opens edit; keyboard drag can change day without mouse.
    await deadline(a, '.calendar-week-all-day').locator('button').click();
    await a.getByRole('dialog').waitFor(); await a.getByRole('button', { name: 'Đóng công việc', exact: true }).click();
    const source = deadline(a, '.calendar-week-all-day').locator('button');
    await source.focus(); await a.keyboard.press('Space'); await a.locator('.task-calendar-drag-preview').waitFor();
    await a.keyboard.press('End');
    await allDay(dates[6]).locator('.calendar-deadline-drop-caption').waitFor();
    await a.keyboard.press('Space');
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    await check(dates[6], null);
    await deadline(a, '.calendar-week-all-day').locator('button').focus();
    await a.keyboard.press('Space'); await a.locator('.task-calendar-drag-preview').waitFor();
    await a.keyboard.press('ArrowDown');
    await slot(dates[6], '06:00').locator('.calendar-deadline-drop-caption').waitFor();
    await a.keyboard.press('ArrowDown');
    await slot(dates[6], '07:00').locator('.calendar-deadline-drop-caption').waitFor();
    await a.keyboard.press('Space');
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    await check(dates[6], '07:00');
    // Browsing a distant mini-month must not widen the main deadline query past 93 days.
    for (let i = 0; i < 5; i++) await a.locator('.calendar-mini').getByRole('button', { name: 'Tháng sau', exact: true }).click();
    await a.waitForTimeout(500);
    await deadline(a, '.calendar-time-column').waitFor();
    assert.equal(await a.locator('.calendar-error-state').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: widget deadline drag keeps time; full-calendar all-day clears time, hour slots set date/time, same-date time changes, 24px markers, undo, reminders recalculated, two-session realtime, click/checkbox and keyboard drag.');
  } finally {
    if (token && task) await first.request.delete(base + '/api/tasks/' + task.id, { headers: { Authorization: `Bearer ${token}` } });
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
