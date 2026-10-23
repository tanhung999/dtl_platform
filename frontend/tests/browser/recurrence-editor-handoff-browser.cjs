const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(1);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
    page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
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
    const range = () => api('GET', '/api/calendar/events/collection?' + new URLSearchParams({ start: '2099-10-19T00:00:00+07:00', end: '2099-10-25T00:00:00+07:00' }));
    const moveDialog = page.getByRole('dialog', { name: 'Dời lịch / Thông báo', exact: true });
    const onDay = (id, day) => page.locator(`button[data-event-id="${id}@${day}"], button[data-event-id="${id}"]`);
    for (const kind of ['event', 'note']) for (const scope of ['THIS', 'FOLLOWING']) {
      const title = `Handoff ${kind} ${scope}`;
      const schedule = { starts_at: '2099-10-19T09:00:00+07:00', ends_at: '2099-10-19T10:00:00+07:00', recurrence: 'DAILY' };
      const original = await api('POST', kind === 'event' ? '/api/calendar/events' : '/api/notes', kind === 'event' ? { title, description: 'Original content', ...schedule } : { title, content: 'Original content', calendar_schedule: schedule });
      const eventId = kind === 'event' ? original.id : original.calendar_schedule.event_id;
      await page.goto(base + '/calendar?date=2099-10-21', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
      await onDay(eventId, '2099-10-21').click();
      const detail = kind === 'event' ? page.locator('.calendar-event-dialog') : page.getByRole('dialog', { name: 'Ghi chú', exact: true });
      const titleInput = kind === 'event' ? detail.getByLabel('Tên sự kiện', { exact: true }) : detail.getByPlaceholder('Tiêu đề ghi chú...');
      const contentInput = kind === 'event' ? detail.locator('textarea') : detail.getByPlaceholder('Nhập nội dung ghi chú ở đây...');
      await titleInput.fill(title + ' renamed'); await contentInput.fill('Unsaved content survives all moves');
      const openMove = () => detail.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click();
      const apply = async (hour, loseResponse = false) => {
        await openMove();
        if (scope === 'FOLLOWING') await moveDialog.getByRole('radio', { name: /Lần này và các lần sau/ }).check();
        await moveDialog.getByLabel('Giờ bắt đầu mới', { exact: true }).fill(hour + ':00');
        await moveDialog.getByLabel('Giờ kết thúc mới', { exact: true }).fill((hour + 1) + ':00');
        const pattern = '**/api/schedule-changes/' + kind + '/*';
        let dropped = false, keys = [];
        if (loseResponse) await page.route(pattern, async route => {
          if (route.request().method() !== 'POST') return route.continue();
          keys.push(route.request().postDataJSON().request_id);
          if (dropped) return route.continue();
          dropped = true; const response = await route.fetch(); assert.ok(response.ok()); await route.abort('failed');
        });
        const response = page.waitForResponse(response => response.url().includes('/api/schedule-changes/' + kind + '/') && response.request().method() === 'POST' && response.ok());
        await moveDialog.getByRole('button', { name: 'Áp dụng', exact: true }).click();
        const change = await (await response).json(); await moveDialog.waitFor({ state: 'hidden' });
        if (loseResponse) { await page.unroute(pattern); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); }
        assert.equal(await titleInput.inputValue(), title + ' renamed');
        assert.equal(await contentInput.inputValue(), 'Unsaved content survives all moves');
        assert.ok(await detail.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).isEnabled());
        return change;
      };
      const first = await apply(11, true);
      assert.notEqual(first.editor.resource.id, original.id);
      // Undo must put the same open editor back on the source, keeping its draft.
      await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
      await page.locator('.reschedule-toast').waitFor({ state: 'hidden' });
      assert.equal(await titleInput.inputValue(), title + ' renamed');
      const fresh = await apply(11);
      const again = await apply(13);
      assert.equal(again.editor.kind, kind);
      if (scope === 'THIS') assert.equal(again.editor.resource.id, fresh.editor.resource.id);
      else assert.notEqual(again.editor.resource.id, fresh.editor.resource.id);
      const target = again.editor.resource;
      const savePath = kind === 'event' ? '/api/calendar/events/' : '/api/notes/';
      const saved = page.waitForResponse(response => response.url().endsWith(savePath + target.id) && response.request().method() === (kind === 'event' ? 'PUT' : 'PATCH'));
      await detail.getByRole('button', { name: kind === 'event' ? 'Lưu sự kiện' : 'Lưu ghi chú', exact: true }).click();
      assert.ok((await saved).ok()); await detail.waitFor({ state: 'hidden' });
      const parent = await api('GET', savePath + original.id);
      const child = await api('GET', savePath + target.id);
      assert.equal(parent.title, title); assert.equal(child.title, title + ' renamed');
      assert.equal(kind === 'event' ? parent.description : parent.content, 'Original content');
      assert.equal(kind === 'event' ? child.description : child.content, 'Unsaved content survives all moves');
      const targetEventId = kind === 'event' ? target.id : target.calendar_schedule.event_id;
      const items = (await range()).items;
      const changed = items.filter(item => item.title === title + ' renamed');
      assert.equal(changed.length, scope === 'THIS' ? 1 : 4);
      assert.ok(changed.every(item => item.starts_at.includes('T06:00:00')));
      assert.ok(items.some(item => item.title === title && item.id === eventId + '@2099-10-19'));
      // Deleting this occurrence from the new target must preserve the original series.
      await onDay(targetEventId, '2099-10-21').click();
      await detail.getByRole('button', { name: kind === 'event' ? 'Xóa' : 'Xóa ghi chú', exact: true }).click();
      const confirmation = kind === 'event' ? detail : page.getByRole('dialog', { name: 'Xóa ghi chú?', exact: true });
      await confirmation.getByRole('radio', { name: /Chỉ lần này/ }).check();
      await confirmation.getByRole('button', { name: kind === 'event' ? 'Xác nhận xóa' : 'Xóa ghi chú', exact: true }).click();
      await detail.waitFor({ state: 'hidden' });
      const remaining = (await range()).items;
      assert.ok(remaining.some(item => item.id === eventId + '@2099-10-19'));
      console.log(`PASS ${kind}/${scope}: lost-response replay, automatic target switch, Undo, repeated moves, draft retention, rename/content saved only to target and single deletion.`);
    }
    // Notes opened from the notes collection use a parent save callback; it must follow the new ID too.
    const widgetNote = await api('POST', '/api/notes', { title: 'Collection source', content: 'Source content', calendar_schedule: { starts_at: '2099-10-26T09:00:00+07:00', ends_at: '2099-10-26T10:00:00+07:00', recurrence: 'DAILY' } });
    await page.goto(base + '/notes', { waitUntil: 'domcontentloaded' });
    await page.locator(`[data-note-id="${widgetNote.id}"] .note-title`).click();
    const noteDetail = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await noteDetail.getByPlaceholder('Tiêu đề ghi chú...').fill('Collection target renamed');
    await noteDetail.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click();
    await moveDialog.getByLabel('Giờ bắt đầu mới', { exact: true }).fill('11:00');
    await moveDialog.getByLabel('Giờ kết thúc mới', { exact: true }).fill('12:00');
    const widgetResponse = page.waitForResponse(response => response.url().endsWith('/api/schedule-changes/note/' + widgetNote.id) && response.request().method() === 'POST');
    await moveDialog.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    const widgetChange = await (await widgetResponse).json();
    await moveDialog.waitFor({ state: 'hidden' });
    await noteDetail.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    await noteDetail.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', '/api/notes/' + widgetNote.id)).title, 'Collection source');
    assert.equal((await api('GET', '/api/notes/' + widgetChange.editor.resource.id)).title, 'Collection target renamed');
    console.log('PASS note collection: parent save callback uses the current note ID after a split.');

    // If the editor snapshot cannot load after commit, retry reads the target without repeating the move.
    const source = await api('POST', '/api/calendar/events', { title: 'Sync source', starts_at: '2099-11-01T09:00:00+07:00', ends_at: '2099-11-01T10:00:00+07:00', recurrence: 'DAILY' });
    await page.goto(base + '/calendar?date=2099-11-01', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await onDay(source.id, '2099-11-01').click();
    const syncDetail = page.locator('.calendar-event-dialog');
    await syncDetail.getByLabel('Tên sự kiện', { exact: true }).fill('Sync target renamed');
    await syncDetail.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click();
    await moveDialog.getByLabel('Giờ bắt đầu mới', { exact: true }).fill('11:00');
    await moveDialog.getByLabel('Giờ kết thúc mới', { exact: true }).fill('12:00');
    let writes = 0, childId, reads = 0;
    const syncPattern = '**/api/schedule-changes/event/' + source.id;
    await page.route(syncPattern, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++;
      const response = await route.fetch(), change = await response.json();
      assert.ok(response.ok()); childId = change.editor.resource.id;
      await page.route('**/api/calendar/events/' + childId, route => {
        if (route.request().method() !== 'GET') return route.continue();
        reads++; return reads === 1 ? route.abort('failed') : route.continue();
      });
      delete change.editor;
      await route.fulfill({ response, json: change });
    });
    await moveDialog.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    await moveDialog.getByRole('button', { name: 'Thử đồng bộ lại', exact: true }).waitFor();
    assert.ok(await moveDialog.getByRole('button', { name: 'Đóng dời lịch', exact: true }).isDisabled());
    await moveDialog.getByRole('button', { name: 'Thử đồng bộ lại', exact: true }).click();
    await moveDialog.waitFor({ state: 'hidden' });
    assert.equal(writes, 1); assert.equal(reads, 2);
    assert.equal(await syncDetail.getByLabel('Tên sự kiện', { exact: true }).inputValue(), 'Sync target renamed');
    await page.unroute(syncPattern);
    await syncDetail.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click();
    await syncDetail.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', '/api/calendar/events/' + source.id)).title, 'Sync source');
    assert.equal((await api('GET', '/api/calendar/events/' + childId)).title, 'Sync target renamed');
    console.log('PASS committed move recovery: retry synchronizes the editor without another write or lost draft.');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
