const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');

(async () => {
  const fixture = createTestUsers(1);
  let browser, release;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    page.setDefaultTimeout(30000);
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    const widget = page.locator('.tasks-widget');
    await widget.waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    for (let i = 0; i < 6; i++) {
      const response = await page.request.post('http://127.0.0.1:5173/api/tasks', {
        headers: { Authorization: `Bearer ${token}` }, data: { title: `Stable task ${i}` },
      });
      assert.equal(response.status(), 201);
    }
    await page.waitForFunction(() => document.querySelectorAll('.tasks-widget .task-item').length === 6);
    await page.waitForTimeout(400);
    let gate, observed, mode;
    await page.route('**/api/tasks/collection?*', async route => {
      if (!mode) return route.continue();
      observed?.();
      if (mode === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary refresh failure' }) });
      await gate;
      await route.continue();
    });
    const hold = () => {
      mode = 'hold'; gate = new Promise(resolve => { release = resolve; });
      return new Promise(resolve => { observed = resolve; });
    };
    let requested = hold();
    await widget.evaluate(element => { window.__stableTasksList = element.querySelector('.tasks-list'); });
    const before = await widget.boundingBox();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await requested;
    await page.waitForTimeout(250);
    assert.equal(await widget.locator('.task-item').count(), 6);
    assert.equal(await widget.getByText('Đang tải công việc…', { exact: true }).count(), 0);
    assert.ok(await widget.evaluate(element => element.querySelector('.tasks-list') === window.__stableTasksList));
    const during = await widget.boundingBox();
    assert.ok(Math.abs(before.height - during.height) < 1);
    let finished = page.waitForResponse(response => response.url().includes('/api/tasks/collection?') && response.status() === 200);
    release(); await finished;
    await page.waitForTimeout(250);
    requested = hold();
    await widget.getByRole('button', { name: /^Đã xong \(/ }).click();
    await requested;
    await widget.getByText('Đang tải công việc…', { exact: true }).waitFor();
    assert.equal(await widget.locator('.task-item').count(), 0);
    finished = page.waitForResponse(response => response.url().includes('/api/tasks/collection?') && response.status() === 200);
    release(); mode = undefined; await finished;
    await widget.getByText('Chưa có công việc hoàn thành.', { exact: true }).waitFor();
    await widget.getByRole('button', { name: /^Tất cả \(/ }).click();
    await widget.locator('.task-item').nth(5).waitFor();
    mode = 'fail';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await widget.getByRole('alert').waitFor();
    assert.equal(await widget.locator('.task-item').count(), 6);
    await widget.getByRole('button', { name: /^Đã xong \(/ }).click();
    await widget.getByRole('alert').waitFor();
    assert.equal(await widget.locator('.task-item').count(), 0);
    mode = undefined;
    await widget.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await widget.getByRole('alert').waitFor({ state: 'hidden' });
    await widget.getByText('Chưa có công việc hoàn thành.', { exact: true }).waitFor();
    await widget.getByRole('button', { name: /^Tất cả \(/ }).click();
    await widget.locator('.task-item').nth(5).waitFor();
    assert.equal(await widget.locator('.task-item').count(), 6);
    // The server's next deadline triggers one background read without focus or periodic polling.
    await page.unroute('**/api/tasks/collection?*');
    let deadlineReads = 0, deadlineReloaded;
    const deadlineDone = new Promise(resolve => { deadlineReloaded = resolve; });
    await page.route('**/api/tasks/collection?*', async route => {
      const response = await route.fetch(); const body = await response.json(); deadlineReads++;
      body.server_now = new Date().toISOString();
      body.next_refresh_at = deadlineReads === 1 ? new Date(Date.now() + 800).toISOString() : null;
      await route.fulfill({ response, json: body });
      if (deadlineReads === 2) deadlineReloaded();
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await Promise.race([deadlineDone, new Promise((_, reject) => setTimeout(() => reject(new Error('No scheduled deadline refresh')), 10000))]);
    await page.waitForTimeout(1000);
    assert.equal(deadlineReads, 2, 'no repeated requests after next_refresh_at becomes null');
    assert.equal(await widget.locator('.task-item').count(), 6);
    console.log('PASS: deadline boundary refresh runs once in the background and stops when no future check is scheduled.');
    console.log('PASS: focus refresh preserves To-Do DOM and height; filters show loading; failed refresh retains tasks and retry recovers.');
  } finally {
    release?.();
    if (browser) await browser.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
