const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
(async () => {
  const fixture = createTestUsers(2); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base + '/login');
    await page.locator('#username').fill(fixture.accounts[0].username);
    await page.locator('#password').fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: /Đăng nhập hệ thống/ }).click();
    await page.waitForURL('**/homepage');
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const headers = { Authorization: 'Bearer ' + token, 'X-Platform-Request': '1', Origin: base };
    const created = await page.request.post(base + '/api/calendar/events', { headers, data: {
      title: 'QA follower-only save', starts_at: '2099-10-19T09:00:00+07:00', ends_at: '2099-10-19T10:00:00+07:00', follower_ids: [fixture.accounts[1].id],
    } });
    assert.equal(created.status(), 201); const event = await created.json();
    let saves = 0;
    page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/api/calendar/events/' + event.id)) saves++; });
    await page.goto(base + '/calendar?date=2099-10-19');
    await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    const open = async () => { await page.locator(`[data-event-id="${event.id}"]`).click(); await page.locator('.calendar-event-dialog').waitFor(); };
    const detail = page.locator('.calendar-event-dialog');
    const save = async () => { await detail.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click(); await detail.waitFor({ state: 'detached' }); };
    await open();
    await detail.getByRole('button', { name: 'Xóa Test QA', exact: true }).click();
    await save();
    let response = await page.request.get(base + '/api/calendar/events/' + event.id, { headers });
    assert.deepEqual((await response.json()).followers, []); assert.equal(saves, 1);
    await open();
    await detail.getByPlaceholder('Tìm theo tên hoặc tài khoản…').fill(fixture.accounts[1].username);
    await detail.locator('.people-picker-results button').filter({ hasText: '@' + fixture.accounts[1].username }).click();
    await save();
    response = await page.request.get(base + '/api/calendar/events/' + event.id, { headers });
    assert.deepEqual((await response.json()).followers.map(user => user.id), [fixture.accounts[1].id]); assert.equal(saves, 2);
    await open(); await save(); assert.equal(saves, 2, 'An unchanged follower list must not create another update');
    console.log('PASS remove/add only event followers persists; unchanged save sends no write');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
