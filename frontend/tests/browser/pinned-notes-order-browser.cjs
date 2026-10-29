const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(1); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base + '/login');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.waitForURL('**/homepage');
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async (method, url, data) => {
      const response = await page.request.fetch(base + '/api/' + url, { method, data, headers: { Authorization: `Bearer ${token}` } });
      assert.ok(response.ok(), await response.text()); return response.json();
    };
    const notes = [];
    for (let i = 0; i < 7; i++) notes.push(await api('POST', 'notes', { title: 'QA pinned order ' + i }));
    for (let i = notes.length - 1; i >= 0; i--) notes[i] = await api('PATCH', 'notes/' + notes[i].id, { expected_version: notes[i].version, is_pinned: true });
    const cards = page.locator('.pinned-notes-widget .note-card');
    const expectOrder = async ids => {
      await page.waitForFunction(expected => JSON.stringify(Array.from(document.querySelectorAll('.pinned-notes-widget .note-card'), node => node.dataset.noteId)) === JSON.stringify(expected), ids);
      assert.equal(await cards.count(), 4);
    };
    await expectOrder(notes.slice(0, 4).map(note => note.id));
    await page.reload();
    await expectOrder(notes.slice(0, 4).map(note => note.id));
    notes[3] = await api('PATCH', 'notes/' + notes[3].id, { expected_version: notes[3].version, content: 'Edit without moving the pin' });
    await expectOrder(notes.slice(0, 4).map(note => note.id));
    notes[6] = await api('PATCH', 'notes/' + notes[6].id, { expected_version: notes[6].version, is_pinned: false });
    notes[6] = await api('PATCH', 'notes/' + notes[6].id, { expected_version: notes[6].version, is_pinned: true });
    await expectOrder([notes[6].id, ...notes.slice(0, 3).map(note => note.id)]);
    console.log('PASS: homepage shows four most recently pinned notes, persists after reload, edits do not reorder, repinning an older note moves it first.');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
