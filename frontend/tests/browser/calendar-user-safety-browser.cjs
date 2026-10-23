const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

(async () => {
  const fixture = createTestUsers(1);
  let browser, release;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.workspace-home').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async (method, path, data) => {
      const response = await page.request.fetch(base + path, { method, data, headers: { Authorization: 'Bearer ' + token } });
      assert.ok(response.ok(), await response.text());
      return response.status() === 204 ? null : response.json();
    };
    const day = '2099-10-23';
    const event = await api('POST', '/api/calendar/events', { title: 'Safety event', starts_at: day + 'T09:00:00+07:00', ends_at: day + 'T10:00:00+07:00', recurrence: 'DAILY' });
    const note = await api('POST', '/api/notes', { title: 'Safety note', content: 'Original content', calendar_schedule: { starts_at: day + 'T13:00:00+07:00', ends_at: day + 'T14:00:00+07:00', recurrence: 'DAILY' } });
    const task = await api('POST', '/api/tasks', { title: 'Safety task', due_date: day, due_time: '09:00' });
    const calendar = async () => {
      await page.goto(base + '/calendar?date=' + day, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    };
    const item = (id, date = day) => page.locator(`button[data-event-id="${id}@${date}"]`);
    // Gate the response to prove repeat submissions are blocked before React's busy render.
    const saveTwice = async (dialog, path, method, closeName) => {
      const reached = deferred(), gate = deferred(); release = gate.resolve;
      let writes = 0;
      const pattern = '**' + path;
      await page.route(pattern, async route => {
        if (route.request().method() !== method) return route.continue();
        writes++;
        const response = await route.fetch(); reached.resolve(); await gate.promise;
        await route.fulfill({ response });
      });
      await dialog.locator('form').evaluate(form => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await reached.promise;
      assert.ok(await dialog.getByRole('button', { name: closeName, exact: true }).isDisabled());
      assert.equal(await dialog.locator('form').getAttribute('aria-busy'), 'true');
      gate.resolve(); await dialog.waitFor({ state: 'hidden' });
      assert.equal(writes, 1);
      await page.unroute(pattern);
    };
    await calendar();
    await item(event.id).click();
    let dialog = page.locator('.calendar-event-dialog');
    await dialog.getByLabel('Tên sự kiện', { exact: true }).fill('Safety event saved');
    await saveTwice(dialog, '/api/calendar/events/' + event.id, 'PUT', 'Đóng');
    assert.equal((await api('GET', '/api/calendar/events/' + event.id)).title, 'Safety event saved');
    await item(note.calendar_schedule.event_id).click();
    dialog = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await dialog.getByPlaceholder('Nhập nội dung ghi chú ở đây...').fill('Saved note draft');
    await saveTwice(dialog, '/api/notes/' + note.id, 'PATCH', 'Đóng ghi chú');
    assert.equal((await api('GET', '/api/notes/' + note.id)).content, 'Saved note draft');
    await page.locator(`[data-deadline-id="${task.id}"]`).getByRole('button').click();
    dialog = page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true });
    await dialog.getByLabel('Tên công việc', { exact: true }).fill('Safety task saved');
    await saveTwice(dialog, '/api/tasks/' + task.id, 'PATCH', 'Đóng công việc');
    assert.equal((await api('GET', '/api/tasks/' + task.id)).title, 'Safety task saved');
    console.log('PASS: event/note/task double submit produces one write, pending forms stay open, saved values verified.');

    await item(event.id).click();
    dialog = page.locator('.calendar-event-dialog');
    await dialog.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click();
    const move = page.getByRole('dialog', { name: 'Dời lịch / Thông báo', exact: true });
    assert.equal(await move.locator('.reschedule-scope-summary').count(), 0);
    const applyBox = await move.getByRole('button', { name: 'Áp dụng', exact: true }).boundingBox();
    assert.ok(applyBox.y >= 0 && applyBox.y + applyBox.height <= 900, 'Apply must stay in the visible dialog');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileApply = await move.getByRole('button', { name: 'Áp dụng', exact: true }).boundingBox();
    assert.ok(mobileApply.y >= 0 && mobileApply.y + mobileApply.height <= 844);
    assert.ok(await move.evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.screenshot({ path: '.audit-backups/user-safety-settings-mobile.png' });
    await page.setViewportSize({ width: 1366, height: 900 });
    await move.getByLabel('Giờ bắt đầu mới', { exact: true }).fill('11:00');
    await move.getByLabel('Giờ kết thúc mới', { exact: true }).fill('12:00');
    await saveTwice(move, '/api/schedule-changes/event/' + event.id, 'POST', 'Đóng dời lịch');
    assert.ok(await dialog.getByRole('button', { name: 'Xóa', exact: true }).isDisabled());
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    console.log('PASS: scoped move cannot silently switch the existing editor to whole-series deletion.');

    const next = '2099-10-24';
    await item(event.id, next).click();
    await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
    await dialog.getByRole('radio', { name: /Lần này và các lần sau/ }).check();
    await dialog.locator('.calendar-delete-confirm > p').filter({ hasText: 'Các lần đã chọn và thông báo tương ứng sẽ bị xóa.' }).waitFor();
    const pattern = '**/api/calendar/events/' + event.id + '?*';
    await page.route(pattern, async route => {
      if (route.request().method() !== 'DELETE') return route.continue();
      const response = await route.fetch(); assert.ok(response.ok()); await route.abort('failed');
    });
    await dialog.getByRole('button', { name: 'Xác nhận xóa', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Chưa xác nhận được kết quả xóa.' }).waitFor();
    assert.ok(await dialog.getByRole('button', { name: 'Xác nhận xóa', exact: true }).isDisabled());
    assert.ok(await dialog.getByRole('radio').first().isDisabled());
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.unroute(pattern);
    const items = (await api('GET', '/api/calendar/events/collection?' + new URLSearchParams({ start: day + 'T00:00:00+07:00', end: '2099-10-27T00:00:00+07:00' }))).items;
    assert.ok(!items.some(value => value.series_id === event.id && value.starts_at.slice(0, 10) >= next));
    console.log('PASS: lost scoped-delete confirmation locks scope, preserves earlier occurrences and requests calendar verification.');
    // A lost note occurrence deletion must not be retried against a different scope.
    await item(note.calendar_schedule.event_id, next).click();
    const noteEditor = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await noteEditor.getByRole('button', { name: 'Xóa ghi chú', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Xóa ghi chú?', exact: true });
    await confirmation.getByRole('radio', { name: /Chỉ lần này/ }).waitFor();
    const notePattern = '**/api/notes/' + note.id;
    await page.route(notePattern, async route => {
      if (route.request().method() !== 'DELETE') return route.continue();
      const response = await route.fetch(); assert.ok(response.ok()); await route.abort('failed');
    });
    await confirmation.getByRole('button', { name: 'Xóa ghi chú', exact: true }).click();
    await confirmation.getByRole('alert').filter({ hasText: 'Chưa xác nhận được kết quả xóa.' }).waitFor();
    assert.ok(await confirmation.getByRole('button', { name: 'Xóa ghi chú', exact: true }).isDisabled());
    assert.ok(await confirmation.getByRole('radio').first().isDisabled());
    await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click();
    await noteEditor.getByRole('button', { name: 'Đóng ghi chú', exact: true }).click();
    await page.unroute(notePattern);
    assert.equal((await api('GET', '/api/notes/' + note.id)).content, 'Saved note draft');
    console.log('PASS: lost note occurrence deletion preserves note content and locks scope until calendar verification.');

    await page.getByRole('button', { name: 'Tuần', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.calendar-view-content')?.getAttribute('aria-busy') === 'false');
    const rangePattern = '**/api/calendar/events/collection?*';
    const arrived = deferred(), oldGate = deferred(); release = oldGate.resolve;
    let oldRange = true, latestRange;
    await page.route(rangePattern, async route => {
      if (oldRange) {
        oldRange = false;
        const response = await route.fetch(); arrived.resolve(); await oldGate.promise;
        await route.fulfill({ response }).catch(() => {});
      } else {
        latestRange = new URL(route.request().url()).searchParams;
        await route.continue();
      }
    });
    const nextWeek = page.getByRole('button', { name: 'Khoảng thời gian sau', exact: true });
    await nextWeek.click(); await arrived.promise;
    await nextWeek.click();
    await page.waitForFunction(() => document.querySelector('.calendar-view-content')?.getAttribute('aria-busy') === 'false');
    assert.ok(latestRange);
    const visibleDates = () => page.locator('.calendar-view-content button[data-event-id]').evaluateAll(nodes => nodes.map(node => node.dataset.eventId.split('@')[1]).filter(Boolean));
    const expectedStart = new Date(Date.parse(latestRange.get('start')) + 7 * 3600000).toISOString().slice(0, 10);
    const expectedEnd = new Date(Date.parse(latestRange.get('end')) + 7 * 3600000).toISOString().slice(0, 10);
    let shown = await visibleDates(); assert.ok(shown.length);
    assert.ok(shown.every(date => date >= expectedStart && date < expectedEnd));
    // Canceled transports cannot publish their late result to the current range.
    oldGate.resolve();
    await page.unroute(rangePattern);
    shown = await visibleDates(); assert.ok(shown.every(date => date >= expectedStart && date < expectedEnd));
    console.log('PASS: rapid week navigation ignores a delayed previous-week response.');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '.audit-backups/user-safety-calendar.png' });
  } finally {
    release?.();
    await browser?.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
