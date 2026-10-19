// Creates and cleans up only marked QA tasks; exercises actual dnd-kit sensors.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://127.0.0.1:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 2200 }, hasTouch: true });
  const second = await browser.newContext({ viewport: { width: 1440, height: 2200 } });
  const a = await first.newPage(), b = await second.newPage(), ids = [], errors = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  let token;
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
  const row = (page, task) => page.locator(`.tasks-widget [data-task-id="${task.id}"]`);
  const displayDate = date => new Date(date + 'T00:00:00Z').toLocaleDateString('vi-VN', { timeZone: 'UTC' });
  const day = (page, date) => page.locator(`.calendar-widget-week button[data-date="${date}"]`);
  const drop = async (task, date, cancel = false) => {
    const handle = row(a, task).locator('.task-calendar-drag-handle');
    await handle.scrollIntoViewIfNeeded();
    const start = await handle.boundingBox(), target = await day(a, date).boundingBox();
    await a.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await a.mouse.down();
    await a.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2, { steps: 3 });
    await a.locator('.task-calendar-drag-preview').waitFor();
    await a.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
    await day(a, date).locator('.calendar-drop-label').waitFor();
    assert.equal(await day(a, date).evaluate(el => getComputedStyle(el).outlineColor), 'rgb(29, 78, 216)');
    if (cancel) await a.keyboard.press('Escape');
    await a.mouse.up();
  };
  const undo = async () => {
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await a.getByText('Đã hoàn tác hạn công việc', { exact: true }).waitFor();
  };
  try {
    await login(a); await login(b);
    token = await a.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const date = await a.locator('.calendar-widget-week button').last().getAttribute('data-date');
    const earlier = new Date(Date.parse(date + 'T00:00:00Z') - 10 * 86400000).toISOString().slice(0, 10);
    const tasks = [];
    for (const payload of [{ title: 'không hạn', due_date: null }, { title: 'gia hạn', due_date: earlier, due_time: '16:56' }, { title: 'đã xong', due_date: null }]) {
      const task = await api('POST', 'tasks', { ...payload, title: `[Dnd QA ${Date.now()}] ${payload.title}`, priority: 'HIGH' });
      ids.push(task.id); tasks.push(task); await row(a, task).waitFor(); await row(b, task).waitFor();
    }
    let [undated, timed, completed] = tasks;
    // Dragging task text does not activate the sensor.
    await row(a, undated).scrollIntoViewIfNeeded();
    const contentBox = await row(a, undated).boundingBox();
    await a.mouse.move(contentBox.x + contentBox.width / 2, contentBox.y + 10); await a.mouse.down();
    await a.mouse.move(contentBox.x + contentBox.width / 2 + 30, contentBox.y + 10, { steps: 5 });
    assert.equal(await a.locator('.task-calendar-drag-preview').count(), 0);
    await a.mouse.up();
    await drop(undated, date, true);
    assert.ok((await row(a, undated).innerText()).includes('Không hạn'));
    await drop(undated, date);
    await a.locator('.task-calendar-toast').getByText(`Đã đặt hạn ${date.slice(8, 10)}/${date.slice(5, 7)}`, { exact: true }).waitFor();
    await day(b, date).click();
    await b.locator(`.calendar-widget [data-deadline-id="${undated.id}"]`).waitFor();
    assert.ok((await row(b, undated).innerText()).includes(displayDate(date)));
    await undo();
    await row(b, undated).getByText('Không hạn', { exact: true }).waitFor();
    assert.equal(await b.locator(`.calendar-widget [data-deadline-id="${undated.id}"]`).count(), 0);

    await drop(timed, date);
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    await row(b, timed).getByText(new RegExp(displayDate(date) + ' 16:56')).waitFor();
    assert.equal(await row(a, timed).evaluate(el => el.classList.contains('is-overdue')), false);
    await undo();
    await row(b, timed).getByText(new RegExp(displayDate(earlier) + ' 16:56')).waitFor();

    // Normal controls keep their click behavior; dragging completed tasks preserves completion.
    await row(a, completed).getByRole('checkbox').click();
    await a.waitForFunction(id => document.querySelector(`[data-task-id="${id}"]`)?.classList.contains('completed'), completed.id);
    await drop(completed, date);
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    assert.ok(await row(a, completed).getByRole('checkbox').isChecked());
    await undo();

    // Keyboard: pick up, choose the first day, move to the last day, then drop.
    const handle = row(a, undated).locator('.task-calendar-drag-handle');
    await handle.focus(); await a.keyboard.press('Space'); await a.locator('.task-calendar-drag-preview').waitFor();
    await a.keyboard.press('ArrowRight'); await a.locator('.calendar-drop-label').waitFor(); await a.keyboard.press('End');
    await day(a, date).locator('.calendar-drop-label').waitFor();
    await a.keyboard.press('Space');
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    await row(b, undated).getByText(new RegExp(displayDate(date))).waitFor();

    // A subsequent deadline edit in another session must not be overwritten by Undo.
    const changedDate = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    await api('PATCH', 'tasks/' + undated.id, { due_date: changedDate, due_time: '08:30' });
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await a.locator('.task-calendar-toast.is-error').waitFor();
    const latest = (await api('GET', 'tasks')).find(task => task.id === undated.id);
    assert.equal(latest.due_date, changedDate); assert.equal(latest.due_time, '08:30');

    // A native touch gesture uses the hold sensor and the same deadline flow.
    const touch = await first.newCDPSession(a);
    const grip = await row(a, completed).locator('.task-calendar-drag-handle').boundingBox();
    const destination = await day(a, date).boundingBox();
    const touchPoint = (x, y) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(grip.x + grip.width / 2, grip.y + grip.height / 2) });
    await a.locator('.task-calendar-drag-preview').waitFor();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(destination.x + destination.width / 2, destination.y + destination.height / 2) });
    await day(a, date).locator('.calendar-drop-label').waitFor();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await a.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    await undo(); await touch.detach();

    await a.route(`**/api/tasks/${completed.id}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { detail: 'Lỗi thử nghiệm đặt hạn' } }) : route.continue());
    await drop(completed, date);
    await a.locator('.task-calendar-toast.is-error').waitFor();
    assert.equal((await api('GET', 'tasks')).find(task => task.id === completed.id).due_date, null, 'Failed drop does not mutate the deadline');
    await a.unroute(`**/api/tasks/${completed.id}`);
    await a.setViewportSize({ width: 390, height: 844 });
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Drag handles and error toast fit mobile');
    assert.deepEqual(errors, []);
    console.log('PASS: pointer/touch/keyboard drag, hover/cancel, undated/all-day, timed/overdue, completed tasks, undo, two-session realtime, guarded stale undo, failed drop and mobile width.');
  } finally {
    if (token) for (const id of ids) await first.request.delete(base + '/api/tasks/' + id, { headers: { Authorization: `Bearer ${token}` } });
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
