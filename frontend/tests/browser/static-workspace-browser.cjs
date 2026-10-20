// Bố cục cố định, không còn API/tay cầm kéo thả; sửa và ghim vẫn hoạt động.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
(async () => {
  const fixture = createTestUsers(1); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [], removedReads = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/\/api\/(workspace\/(layout|widgets)|notes\/[^/]+\/move|calendar\/events\/[^/]+\/schedule)/.test(request.url())) removedReads.push(request.url()); });
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const response = await page.request.post('http://127.0.0.1:5173/api/notes', { headers: { Authorization: 'Bearer ' + token }, data: { title: 'Static workspace note', content: 'Content retained' } });
    assert.equal(response.status(), 201); const note = await response.json();
    const card = page.locator(`[data-note-id="${note.id}"]`); await card.waitFor();
    await card.getByRole('button', { name: 'Ghim ' + note.title, exact: true }).click();
    await page.locator(`[data-note-id="${note.id}"].pinned`).waitFor();
    await card.locator('.note-title').click();
    const editor = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await editor.getByPlaceholder('Tiêu đề ghi chú...').fill('Edited static note');
    await editor.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    await card.getByText('Edited static note', { exact: true }).waitFor();
    assert.equal(await page.locator('.workspace-sort-handle, .dashboard-widget-handle, .task-calendar-drag-handle, .calendar-event-resize, .notes-pin-zone, [aria-roledescription="draggable"]').count(), 0);
    const calendar = await page.locator('.calendar-widget').boundingBox(), notes = await page.locator('.notes-widget').boundingBox();
    assert.ok(calendar.y < notes.y); assert.equal(Math.round(calendar.x), Math.round(notes.x));
    await page.reload(); await card.waitFor();
    assert.ok(await card.evaluate(node => node.classList.contains('pinned')));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(removedReads, []); assert.deepEqual(errors, []);
    console.log('PASS: fixed desktop/mobile layout, pin/edit/reload, no drag controls or removed API requests');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
