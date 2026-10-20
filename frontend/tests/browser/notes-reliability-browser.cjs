const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
async function main() {
  const fixture = createTestUsers(1); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(25000); page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:5173'; let token;
    const api = async (method, route, data) => { const r = await context.request.fetch(base + '/api/' + route, { method, data, headers: { Authorization: `Bearer ${token}` } }); assert.ok(r.ok(), `${route}: ${r.status()}`); return r.status() === 204 ? null : r.json(); };
    await page.goto(base); await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username); await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password); await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click(); await page.locator('.calendar-widget').waitFor();
    token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const widget = page.locator('.notes-widget'), editor = () => page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    // Commit POST, then drop the response. User edits and retries the same logical create.
    const createKeys = []; let createdId, createCalls = 0;
    const lostCreate = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      createCalls++; createKeys.push(route.request().postDataJSON().request_id);
      const response = await route.fetch(); createdId = (await response.json()).id;
      if (createCalls === 1) await route.abort('failed'); else await route.fulfill({ response });
    };
    await page.route('**/api/notes', lostCreate);
    await widget.getByRole('button', { name: 'Thêm', exact: true }).click();
    await editor().getByPlaceholder('Tiêu đề ghi chú...').fill('Network replay');
    await editor().getByPlaceholder('Nhập nội dung ghi chú ở đây...').fill('Original');
    await editor().getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    await editor().getByRole('button', { name: 'Lưu ghi chú', exact: true }).waitFor();
    await page.waitForFunction(() => !!document.querySelector('.note-editor-dialog [role=alert]'));
    await editor().getByPlaceholder('Nhập nội dung ghi chú ở đây...').fill('Edited after lost response');
    await editor().getByRole('button', { name: 'Lưu ghi chú', exact: true }).click(); await editor().waitFor({ state: 'hidden' });
    assert.equal(createCalls, 2); assert.ok(createKeys[0]); assert.equal(createKeys[0], createKeys[1]);
    const created = (await api('GET', 'notes')).filter(n => n.title === 'Network replay');
    assert.equal(created.length, 1); assert.equal(created[0].content, 'Edited after lost response');
    await page.unroute('**/api/notes', lostCreate);
    console.log('PASS: lost create response, stable request ID, retry with edited content creates exactly one note.');
    // Delete commits, but response is stalled. Timeout verifies 404 and closes confirmation.
    const card = id => page.locator(`[data-note-id="${id}"]`), confirmation = () => page.getByRole('dialog', { name: 'Xóa ghi chú?', exact: true });
    await card(createdId).getByTitle('Xóa ghi chú', { exact: true }).click();
    await confirmation().getByRole('button', { name: 'Xóa ghi chú', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.note-delete-confirm').disabled);
    let release, deleteDone; const gate = new Promise(r => { release = r; }), committed = new Promise(r => { deleteDone = r; });
    const lostDelete = async route => { if (route.request().method() !== 'DELETE') return route.continue(); const response = await route.fetch(); deleteDone(); await gate; await route.fulfill({ response }).catch(() => {}); };
    await page.route(`**/api/notes/${createdId}`, lostDelete);
    const started = Date.now(); await confirmation().getByRole('button', { name: 'Xóa ghi chú', exact: true }).click(); await committed;
    await confirmation().waitFor({ state: 'hidden', timeout: 23000 });
    assert.ok(Date.now() - started < 23000); release(); await page.unroute(`**/api/notes/${createdId}`, lostDelete);
    console.log('PASS: stalled successful deletion recovers through a read-only status check within the timeout.');
    // A stalled uncommitted request and unavailable verification unlock the dialog, without resending DELETE.
    const uncertain = await api('POST', 'notes', { title: 'Unknown deletion status' });
    await card(uncertain.id).getByTitle('Xóa ghi chú', { exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.note-delete-confirm').disabled);
    let deleteCount = 0;
    const noResponse = async route => { if (route.request().method() === 'DELETE') { deleteCount++; await route.abort('failed'); } else await route.continue(); };
    const noVerify = route => route.abort('failed');
    await page.route(`**/api/notes/${uncertain.id}`, noResponse); await page.route(`**/api/notes/${uncertain.id}/delete-info`, noVerify);
    await confirmation().getByRole('button', { name: 'Xóa ghi chú', exact: true }).click(); await confirmation().getByRole('button', { name: 'Kiểm tra lại kết quả', exact: true }).waitFor();
    assert.equal(await confirmation().getByRole('button', { name: 'Hủy', exact: true }).isEnabled(), true);
    await page.unroute(`**/api/notes/${uncertain.id}/delete-info`, noVerify);
    await confirmation().getByRole('button', { name: 'Kiểm tra lại kết quả', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.note-delete-confirm').disabled);
    assert.equal(deleteCount, 1); await confirmation().getByRole('button', { name: 'Hủy', exact: true }).click(); await page.unroute(`**/api/notes/${uncertain.id}`, noResponse);
    console.log('PASS: unknown deletion outcome permits cancel and read-only recheck without duplicate DELETE.');
    const notes = [];
    for (let i = 0; i < 28; i++) notes.push(await api('POST', 'notes', { title: i === 0 ? 'ĐỀ XUẤT phòng kinh doanh' : `Paged note ${i}`, content: i === 0 ? 'Nội dung tìm kiếm ' + 'x'.repeat(1200) : 'x'.repeat(1200) }));
    await page.reload(); await widget.locator('.notes-view-all').click(); await widget.locator('.note-card').nth(23).waitFor();
    assert.equal(await widget.locator('.note-card').count(), 24);
    await widget.getByRole('button', { name: 'Trang sau', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.notes-pagination')?.textContent.includes('25–29'));
    assert.equal(await widget.locator('.note-card').count(), 5);
    const pageResponse = await api('GET', 'notes/collection/page'); assert.equal(pageResponse.items.length, 24); assert.ok(pageResponse.items.every(n => n.preview.length <= 240 && !('content' in n)));
    const searchResponse = page.waitForResponse(r => r.url().includes('/notes/collection/page?') && new URL(r.url()).searchParams.get('q') === 'de xuat');
    await widget.getByRole('searchbox', { name: 'Tìm ghi chú' }).fill('de xuat'); await searchResponse;
    await card(notes[0].id).waitFor(); assert.equal(await widget.locator('.note-card').count(), 1);
    const fullResponse = page.waitForResponse(r => r.url().endsWith('/api/notes/' + notes[0].id)); await card(notes[0].id).click(); await fullResponse;
    await page.waitForFunction(content => document.querySelector('.note-editor-dialog textarea')?.value === content, notes[0].content);
    assert.equal(await editor().getByPlaceholder('Nhập nội dung ghi chú ở đây...').inputValue(), notes[0].content);
    await editor().getByRole('button', { name: 'Đóng ghi chú', exact: true }).click();
    console.log('PASS: 24-item server pages, bounded previews, server Vietnamese search and full content only on open.');
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); fixture.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
