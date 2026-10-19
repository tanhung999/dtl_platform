const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createDragUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');

async function main() {
  const fixture = createDragUsers(1), browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } }), page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let token, task;
  const api = async (method, path, data) => {
    const response = await context.request.fetch('http://127.0.0.1:5173/api/' + path, { method, data, headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok(), `${path}: ${response.status()}`); return response.status() === 204 ? null : response.json();
  };
  const latest = async () => (await api('GET', 'tasks')).find(item => item.id === task.id);
  const dates = () => page.locator('.calendar-widget-week button').evaluateAll(nodes => nodes.map(node => node.dataset.date));
  const row = () => page.locator(`.tasks-widget [data-task-id="${task.id}"]`);
  const start = async source => {
    await source.scrollIntoViewIfNeeded(); const box = await source.boundingBox();
    await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + Math.min(20, box.width / 2) + 12, box.y + box.height / 2, { steps: 3 });
    await page.locator('.task-calendar-drag-preview').waitFor();
  };
  const hover = async (target, fraction = .5) => {
    const box = await target.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height * fraction, { steps: 15 });
    await target.locator('.calendar-drop-label, .calendar-deadline-drop-caption').waitFor();
  };
  const undo = async () => { await page.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click(); await page.getByText('Đã hoàn tác hạn công việc', { exact: true }).waitFor(); };
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click(); await page.locator('.calendar-widget').waitFor();
    token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const week = await dates();
    task = await api('POST', 'tasks', { title: 'QA Drag feedback', priority: 'HIGH', due_date: week[6], due_time: '16:56' });
    await row().waitFor();
    const handle = row().locator('.task-calendar-drag-handle');
    assert.equal(await handle.evaluate(node => getComputedStyle(node).cursor), 'grab');
    await start(handle);
    await page.waitForFunction(id => getComputedStyle(document.querySelector(`[data-task-id="${id}"]`)).opacity === '0.4', task.id);
    const preview = page.locator('.task-calendar-drag-preview');
    assert.equal(await preview.locator('button,input').count(), 0);
    assert.ok((await preview.textContent()).includes('16:56'));
    assert.notEqual(await preview.evaluate(node => getComputedStyle(node).transform), 'none');
    assert.equal(await page.locator('.calendar-widget-week .is-drop-ready').count(), 7);
    const sunday = page.locator(`.calendar-widget-week button[data-date="${week[6]}"]`);
    await hover(sunday); await page.waitForTimeout(850);
    assert.deepEqual(await dates(), week, 'Sunday center does not navigate weeks');
    assert.ok((await sunday.locator('.calendar-drop-label').textContent()).includes('giữ 16:56'));
    assert.equal(await sunday.evaluate(node => getComputedStyle(node).outlineColor), 'rgb(29, 78, 216)');
    await page.mouse.move(10, 10); await page.waitForFunction(() => document.documentElement.dataset.dragCursor === 'not-allowed');
    assert.ok(await preview.evaluate(node => node.classList.contains('is-invalid')));
    await page.mouse.up(); await page.locator('.drag-settle-copy[data-settle-valid="false"]').waitFor();
    assert.equal((await latest()).due_date, week[6]);
    assert.equal(await page.locator('.task-calendar-toast.is-error').count(), 0);
    await start(handle); const target = page.locator(`.calendar-widget-week button[data-date="${week[4]}"]`); await hover(target);
    await page.mouse.up(); await page.locator('.drag-settle-copy[data-settle-valid="true"]').waitFor();
    await page.locator('.task-calendar-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor();
    assert.equal((await latest()).due_time, '16:56');
    assert.ok(await row().getAttribute('data-drag-highlight'));
    await target.click(); const deadline = page.locator(`.calendar-widget [data-deadline-id="${task.id}"]`); await deadline.waitFor();
    assert.ok(await deadline.getAttribute('data-drag-highlight'), 'Both source and calendar highlight after save');
    const toast = page.locator('.task-calendar-toast'), toastBox = await toast.boundingBox(); assert.ok(toastBox.x > 700);
    await toast.hover(); await page.waitForTimeout(6200); assert.equal(await toast.count(), 1, 'Hover pauses expiration');
    await undo(); assert.equal((await latest()).due_date, week[6]);
    // Holding the actual edge navigates, cancellation restores the original view.
    await start(handle); const strip = await page.locator('.calendar-widget-week').boundingBox();
    await page.mouse.move(strip.x + strip.width - 2, strip.y + strip.height / 2);
    await page.locator('[data-drag-edge="right"]').waitFor();
    await page.waitForFunction(original => document.querySelector('.calendar-widget-week button')?.dataset.date !== original, week[0]);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForFunction(original => document.querySelector('.calendar-widget-week button')?.dataset.date === original, week[0]);
    // Dragging the deadline itself across weeks keeps its source snapshot after unmount.
    await sunday.click(); await deadline.waitFor(); await start(deadline.locator('button').first());
    const edge = await page.locator('.calendar-widget-week').boundingBox(); await page.mouse.move(edge.x + edge.width - 2, edge.y + edge.height / 2);
    await page.waitForFunction(original => document.querySelector('.calendar-widget-week button')?.dataset.date !== original, week[0]);
    const following = await dates(); await hover(page.locator(`.calendar-widget-week button[data-date="${following[3]}"]`)); await page.mouse.up();
    await toast.getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor(); assert.equal((await latest()).due_date, following[3]);
    await undo(); assert.deepEqual(await dates(), week); assert.equal((await latest()).due_date, week[6]);
    await page.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    const source = page.locator(`.calendar-time-column [data-deadline-id="${task.id}"] button`).first(); await source.waitFor();
    const grid = page.locator('.calendar-week-scroll');
    // Put late-afternoon cells on screen before testing exact quarter-hour placement.
    await grid.evaluate(node => { node.scrollTop = 8 * 60; });
    await start(source);
    const slot = page.locator(`.calendar-time-slot[data-drop-date="${week[4]}"][data-drop-time="16:00"]`);
    await hover(slot, .5); const ghost = page.locator('[data-drag-ghost]'); await ghost.waitFor();
    assert.ok((await ghost.textContent()).includes('16:30'), 'Ghost: ' + await ghost.textContent()); assert.equal(await ghost.evaluate(node => node.offsetHeight), 24);
    await page.mouse.up(); await toast.getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor(); assert.equal((await latest()).due_time, '16:30');
    const moved = page.locator(`.calendar-time-column [data-deadline-id="${task.id}"] button`).first();
    await start(moved); const allDay = page.locator(`.calendar-week-all-day [data-drop-date="${week[5]}"]`);
    await hover(allDay); assert.ok((await allDay.textContent()).includes('bỏ giờ')); await page.keyboard.press('Escape'); await page.mouse.up();
    // The grid scrolls at its lower edge and displays an edge gradient.
    await start(moved); const before = await grid.evaluate(node => node.scrollTop), rect = await grid.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 8); await page.locator('[data-drag-edge="bottom"]').waitFor();
    await page.waitForFunction(initial => document.querySelector('.calendar-week-scroll').scrollTop > initial + 10, before);
    await page.keyboard.press('Escape'); await page.mouse.up();
    const unchanged = await latest();
    await page.route(`**/api/tasks/${task.id}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"QA simulated failure"}' }) : route.continue());
    await start(moved); await hover(allDay); await page.mouse.up(); await page.locator('.task-calendar-toast.is-error').waitFor();
    assert.ok((await page.locator('.task-calendar-toast.is-error').textContent()).includes('Không lưu được, đã hoàn lại'));
    assert.equal((await latest()).due_time, unchanged.due_time); assert.equal((await latest()).due_date, unchanged.due_date);
    await page.unroute(`**/api/tasks/${task.id}`);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await start(moved);
    assert.equal(await preview.evaluate(node => getComputedStyle(node).transform), 'none'); await page.keyboard.press('Escape'); await page.mouse.up();
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle dark/light theme', exact: true }).click();
    await start(handle); await hover(page.locator(`.calendar-widget-week button[data-date="${week[6]}"]`));
    assert.ok(await preview.evaluate(node => getComputedStyle(node).color !== getComputedStyle(node).backgroundColor));
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.setViewportSize({ width: 390, height: 844 }); await start(handle);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await preview.evaluate(node => node.getBoundingClientRect().width <= innerWidth - 32));
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(errors, []);
    console.log('PASS: compact preview, source opacity, valid/invalid cues, result labels, settle animation, synchronized highlights, 6-second paused toast, week-edge navigation/cancel/undo, unmounted source, 15-minute ghost, grid auto-scroll, API rollback and reduced motion.');
  } finally { await browser.close(); fixture.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
