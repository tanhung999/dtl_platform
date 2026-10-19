const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createDragUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
async function main() {
  const fixture = createDragUsers(1); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
    const a = await context.newPage(), b = await context.newPage(), errors = [];
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    a.setDefaultTimeout(20000); b.setDefaultTimeout(20000);
    const base = 'http://127.0.0.1:5173'; let token, deleteRequests = 0;
    a.on('request', request => { if (request.method() === 'DELETE' && request.url().includes('/api/notes/')) deleteRequests++; });
    const api = async (method, route, data) => { const response = await context.request.fetch(base + '/api/' + route, { method, data, headers: { Authorization: `Bearer ${token}` } }); assert.ok(response.ok(), `${route}: ${response.status()} ${await response.text()}`); return response.status() === 204 ? null : response.json(); };
    await a.goto(base); await a.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username); await a.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password); await a.getByRole('button', { name: 'Đăng nhập hệ thống' }).click(); await a.locator('.calendar-widget').waitFor();
    token = await a.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const notes = [];
    for (const title of [' ', 'Tên ghi chú rất dài '.repeat(10), 'Archived delete QA', 'Calendar editor delete QA']) notes.push(await api('POST', 'notes', { title, content: 'Original content' }));
    await api('PUT', 'workspace/layout/notes', { ids: notes.map(note => note.id), expected_version: 0 });
    const date = await a.evaluate(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const scheduled = await api('PATCH', `notes/${notes[1].id}`, { expected_version: notes[1].version, calendar_schedule: { starts_at: date + 'T09:00:00+07:00', ends_at: date + 'T10:00:00+07:00', is_all_day: false } });
    const eventId = scheduled.calendar_schedule.event_id;
    await a.reload(); await b.goto(base); await b.locator('.notes-widget .note-card').nth(3).waitFor();
    const card = id => a.locator(`[data-sort-id="${id}"]`), confirm = () => a.getByRole('dialog', { name: 'Xóa ghi chú?', exact: true });
    const ids = () => a.locator('.notes-widget [data-sort-id]').evaluateAll(nodes => nodes.map(node => node.dataset.sortId));
    const waitIds = expected => a.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.notes-widget [data-sort-id]')].map(node => node.dataset.sortId)) === JSON.stringify(expected), expected);
    const drag = async (from, to) => {
      const source = card(from).locator('.workspace-sort-handle:not(:disabled)'), target = card(to).locator('.workspace-sort-handle');
      await source.waitFor(); await source.scrollIntoViewIfNeeded(); const s = await source.boundingBox(), t = await target.boundingBox();
      await a.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await a.mouse.down(); await a.mouse.move(s.x + s.width / 2 + 12, s.y + s.height / 2, { steps: 3 }); await a.locator('.workspace-sort-preview').waitFor(); await a.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 20 }); await a.mouse.up();
    };
    const original = notes.map(note => note.id); await waitIds(original);
    if (!process.argv.includes('--delete-only')) {
    // Save failures restore order and remain visible after realtime reads; successful saves are silent.
    const fail = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Simulated save failure' }) });
    await a.route('**/api/notes/*/move', fail); await drag(original[0], original[1]);
    await a.locator('.notes-sort-error').waitFor(); await waitIds(original);
    assert.match(await a.locator('.notes-sort-error').innerText(), /Không lưu được thứ tự/);
    await a.evaluate(() => window.dispatchEvent(new CustomEvent('workspace:changed', { detail: ['notes'] })));
    await card(original[0]).locator('.workspace-sort-handle:not(:disabled)').waitFor();
    assert.equal(await a.locator('.notes-sort-error').count(), 1); assert.equal(await a.locator('.task-calendar-toast').count(), 0);
    await a.getByRole('button', { name: 'Đóng lỗi lưu thứ tự' }).click(); assert.equal(await a.locator('.notes-sort-error').count(), 0);
    await drag(original[0], original[1]); await a.locator('.notes-sort-error').waitFor(); await a.unroute('**/api/notes/*/move', fail);
    await drag(original[0], original[1]); const moved = [original[1], original[0], ...original.slice(2)]; await waitIds(moved);
    await a.waitForFunction(() => !document.querySelector('.notes-sort-error'));
    assert.equal(await a.locator('.task-calendar-toast').count(), 0);
    // A real remote update plus 409 reloads the server order, with no write retry.
    let conflictPuts = 0; let remoteOrder;
    const conflict = async route => {
      conflictPuts++; const current = (await api('GET', 'workspace/layout')).notes; remoteOrder = [...current.ids].reverse();
      await api('PUT', 'workspace/layout/notes', { ids: remoteOrder, expected_version: current.version });
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Changed elsewhere' }) });
    };
    await a.route('**/api/notes/*/move', conflict); await drag(moved[0], moved[1]);
    await a.locator('.notes-sort-error').getByText('Danh sách đã thay đổi. Vui lòng kéo lại.', { exact: true }).waitFor();
    await waitIds(remoteOrder); assert.equal(conflictPuts, 1); await a.unroute('**/api/notes/*/move', conflict);
    await a.getByRole('button', { name: 'Đóng lỗi lưu thứ tự' }).click();
    console.log('PASS: order rollback, persistent/dismissible inline errors, silent success and 409 read-only recovery.');
    }
    // Blank title, default Cancel, Enter and Escape never issue DELETE.
    await card(notes[0].id).getByTitle('Xóa ghi chú', { exact: true }).click();
    await confirm().waitFor(); assert.equal(await confirm().locator('.note-delete-title').innerText(), 'Ghi chú không có tiêu đề');
    assert.equal(await confirm().getByRole('button', { name: 'Hủy', exact: true }).evaluate(node => node === document.activeElement), true);
    await a.keyboard.press('Enter'); await confirm().waitFor({ state: 'hidden' }); assert.equal(deleteRequests, 0);
    await card(notes[0].id).getByTitle('Xóa ghi chú', { exact: true }).click(); await confirm().waitFor(); await a.keyboard.press('Escape'); await confirm().waitFor({ state: 'hidden' }); assert.equal(deleteRequests, 0);
    // Metadata failure blocks deletion until a successful retry; count is exact and title truncates.
    let metadataFail = true;
    const metadata = async route => { if (metadataFail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Không tải được thông tin ghi chú.' }) }); else await route.continue(); };
    await a.route(`**/api/notes/${notes[1].id}/delete-info`, metadata);
    await card(notes[1].id).getByTitle('Xóa ghi chú', { exact: true }).click(); await confirm().getByRole('alert').waitFor();
    assert.equal(await confirm().getByRole('button', { name: 'Xóa ghi chú', exact: true }).isDisabled(), true);
    metadataFail = false;
    await confirm().getByRole('button', { name: 'Thử lại', exact: true }).click(); await confirm().getByText('Lịch hẹn của ghi chú vẫn được giữ trong Lịch.', { exact: true }).waitFor();
    assert.equal(await confirm().locator('.note-delete-title').getAttribute('title'), notes[1].title);
    assert.ok(await confirm().locator('.note-delete-title').evaluate(node => node.scrollWidth > node.clientWidth));
    assert.equal(await confirm().getByRole('button', { name: 'Xóa ghi chú', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(185, 28, 28)');
    let deletes = 0, releaseDelete;
    const pending = new Promise(resolve => { releaseDelete = resolve; });
    const deleting = async route => { deletes++; if (deletes === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Không thể xóa lúc này.' }) }); else { await pending; await route.continue(); } };
    await a.route(`**/api/notes/${notes[1].id}`, deleting);
    await confirm().getByRole('button', { name: 'Xóa ghi chú', exact: true }).click(); await confirm().getByRole('alert').waitFor(); assert.ok(await card(notes[1].id).isVisible());
    await confirm().getByRole('button', { name: 'Xóa ghi chú', exact: true }).click(); await confirm().getByRole('button', { name: 'Đang xóa…', exact: true }).waitFor();
    assert.equal(await confirm().getByRole('button', { name: 'Hủy', exact: true }).isDisabled(), true);
    await a.keyboard.press('Escape'); assert.ok(await confirm().isVisible());
    await confirm().getByRole('button', { name: 'Đang xóa…', exact: true }).evaluate(node => node.click()); assert.equal(deletes, 2);
    releaseDelete(); await confirm().waitFor({ state: 'hidden' });
    for (const page of [a, b]) await page.waitForFunction(id => !document.querySelector(`[data-sort-id="${id}"]`), notes[1].id);
    assert.ok(await api('GET', `calendar/events/${eventId}`));
    console.log('PASS: title handling, schedule retention, metadata retry, Cancel/Enter/Escape, delete failure retry, pending lock, duplicate prevention and realtime removal.');
    const editor = () => a.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await card(notes[3].id).locator('.note-title').click(); await editor().getByPlaceholder('Nhập nội dung ghi chú ở đây...').fill('Uncommitted content');
    await editor().getByRole('button', { name: 'Xóa ghi chú', exact: true }).click(); await confirm().waitFor(); await a.keyboard.press('Escape'); await confirm().waitFor({ state: 'hidden' });
    assert.ok(await editor().isVisible()); assert.equal(await editor().getByPlaceholder('Nhập nội dung ghi chú ở đây...').inputValue(), 'Uncommitted content');
    await editor().getByRole('button', { name: 'Đóng ghi chú', exact: true }).click();
    const latest = await api('GET', `notes/${notes[2].id}`); await api('PATCH', `notes/${notes[2].id}`, { is_archived: true, expected_version: latest.version });
    await a.locator('.notes-view-all').click(); await a.getByRole('button', { name: 'Đã lưu trữ', exact: true }).click(); await card(notes[2].id).waitFor();
    await card(notes[2].id).getByTitle('Xóa ghi chú', { exact: true }).click(); await confirm().getByRole('button', { name: 'Xóa ghi chú', exact: true }).waitFor();
    await a.setViewportSize({ width: 390, height: 844 }); assert.ok((await confirm().boundingBox()).width <= 390);
    require('node:fs').mkdirSync('tests/artifacts', { recursive: true }); await a.screenshot({ path: 'tests/artifacts/note-delete-confirm-mobile.png', fullPage: true });
    await confirm().getByRole('button', { name: 'Hủy', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: shared editor deletion, nested Escape/focus isolation, archived-note confirmation and mobile layout.');
  } catch (error) { if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.log('UI diagnostics', await page.evaluate(() => ({ ids: [...document.querySelectorAll('.notes-widget [data-sort-id]')].map(n => n.dataset.sortId), error: document.querySelector('.notes-sort-error')?.textContent, dialogs: [...document.querySelectorAll('dialog[open]')].map(n => n.textContent.slice(0, 200)) })).catch(() => ({}))); throw error; } finally { if (browser) await browser.close(); fixture.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
